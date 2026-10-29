import { diagnostic } from "../diagnostics/logger";
import { validateCharacterPackage } from "./validateCharacterPackage";
import type { RuntimeCharacterPackage } from "../../shared/characterPackages";
import { writeFileSync } from "node:fs";
import type { AvatarPresentation, AvatarWindowReport, DesktopRect } from "../../shared/avatarDesktop";
import { randomUUID } from "node:crypto";
import { createServer, type Server, type Socket } from "node:net";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { toSpeechServiceError, type SpeechServiceResult, type SpeechService } from "../speech/ttsService";
import { AvatarDialogueSpeech } from "./avatarDialogueSpeech";
import { dirname, join } from "node:path";
import { tool, type ToolSet, type UIMessageChunk } from "ai";
import { z } from "zod";
import { avatarControlSchema, avatarStepSchema, avatarPerformSchema, type AvatarPerformResult, type AvatarPerformanceState } from "../../shared/avatarPerformance";
import { extractSpokenText } from "../speech/spokenText";
import {
  avatarReplySchema,
  type AvatarBinding,
  type AvatarCapabilities,
  type AvatarDanceState,
  type AvatarStatus,
} from "../../shared/avatar";

type Pending = {
  started?: () => void;
  resolve: () => void;
  reject: (error: Error) => void;
  cleanup: () => void;
};
type DancePlayback = { actionId: string; action: string; toolCallId: string; state: AvatarDanceState | null };
const danceTerminal = (state: AvatarDanceState["state"]) => ["completed", "cancelled", "failed"].includes(state);

function describeAction(action: AvatarCapabilities["actions"][number]): string {
  const duration = action.durationSeconds;
  const timing =
    duration !== undefined && duration > 0
      ? `，约 ${Math.max(1, Math.round(duration))} 秒`
      : "";
  const layer = action.layer === "head" ? "，头部" : action.layer === "upperBody" ? "，上半身" : "，全身";
  return `${actionSelector(action)}（${action.label}${layer}${action.kind === "loop" ? "，持续姿态" : timing}）${action.description ? `：${action.description}` : ""}`;
}
function actionSelector(action: AvatarCapabilities["actions"][number]): string {
  return action.key ? `action:${action.key}` : action.id;
}

export class AvatarService {
  private liveBinding: AvatarBinding | null = null;
  private beforeLive: AvatarBinding | null = null;
  private beforeLiveVoice = false;
  get liveActive() { return this.liveBinding !== null; }
  get livePlaybackBusy() { return this.activeRuns.size > 0 || this.playingRunId !== null || [...this.dialogueRuns.values()].some(run => !run.isIdle) || [...this.dances.values()].some(dance => !dance.state || !danceTerminal(dance.state.state)); }
  async acquireLive(binding: AvatarBinding) {
    if (this.liveBinding) throw new Error("已有直播正在占用角色。");
    this.beforeLive = this.state.phase === "ready" ? this.state.binding : null;
    this.beforeLiveVoice = this.voiceDesired;
    this.liveBinding = binding; this.voiceDesired = false; this.changed();
    await this.start(binding);
    this.voiceDesired = false; this.voicePhase = "idle"; this.changed();
  }
  async resetLivePresentation() { if (this.liveBinding && this.state.phase === "ready") await this.rebind(this.liveBinding); }
  async releaseLive(restore: boolean, available: (binding: AvatarBinding) => boolean = () => true) {
    if (!this.liveBinding) return;
    try { if (this.state.phase === "ready") await this.desktopCommand("live-stop", ""); } catch { /* Restore the desktop after an output failure. */ }
    const previous = this.beforeLive; this.beforeLive = null; this.liveBinding = null;
    if (restore && previous && available(previous)) { this.voiceDesired = this.beforeLiveVoice; await this.start(previous); }
    else this.stop();
    this.changed();
  }
  private diagnosticSource = { source: "unity" as const, processInstanceId: randomUUID() };
  onOpenPackages: (() => void) | undefined;
  private packageResolver?: (characterId: string) => RuntimeCharacterPackage;
  private activePackageId: string | undefined;
  configurePackages(resolve: (characterId: string) => RuntimeCharacterPackage): void { this.packageResolver = resolve; }
  async validatePackage(pack: RuntimeCharacterPackage, signal: AbortSignal): Promise<void> {
    // Baking and cancellation belong to an import worker, keeping the current
    // avatar's animation and speech independent of preparation.
    await validateCharacterPackage(this.executable, pack, signal);
  }
  async switchPackage(characterId: string, pack: RuntimeCharacterPackage): Promise<void> {
    if (this.liveBinding?.characterId === characterId) throw new Error("请先停止直播再切换角色包。");
    if (this.starting) await this.starting;
    if (this.switching) await this.switching;
    if (this.state.binding?.characterId !== characterId || this.state.phase !== "ready") return;
    await this.rebind(this.state.binding, pack);
  }
  async reloadPackage(): Promise<void> {
    const binding = this.state.binding;
    if (binding && this.packageResolver) await this.switchPackage(binding.characterId, this.packageResolver(binding.characterId));
  }
  onOpenChat: (() => void) | undefined;
  onWindowState: ((state: AvatarWindowReport) => void) | undefined;
  onDesktopChanged: (() => void) | undefined;
  presentation: AvatarPresentation | null = null;
  get desktopCapabilities() { return this.capabilities ?? null; }
  get inputLevel() { return this.voiceLevel; }
  setVoiceDesired(enabled: boolean): void {
    this.voiceDesired = enabled; this.voicePhase = enabled ? "preparing" : "idle";
    this.voiceError = null; this.changed();
  }
  desktopCommand(operation: string, value: string): Promise<string> {
    const dance = operation === "desktop-action" ? this.capabilities?.actions.find(action => action.id === value && action.kind === "performance") : undefined;
    return this.request(operation, value, new AbortController().signal, "", dance ? { actionId: dance.id, action: dance.label } : undefined);
  }
  sendWindowLayout(value: unknown): void {
    if (this.liveActive) return;
    this.socket?.write(`${JSON.stringify({ type: "window-layout", value: JSON.stringify(value) })}\n`);
  }
  sendWindowInputZones(rects: DesktopRect[]): void {
    this.socket?.write(`${JSON.stringify({ type: "window-input-zones", value: JSON.stringify({ rects }) })}\n`);
  }
  failDesktop(message: string): void { this.fail(message); }
  private speechService?: SpeechService;
  private dialogueRuns = new Map<string, AvatarDialogueSpeech>();
  private mutedRuns = new Set<string>();
  private playingRunId: string | null = null;
  private playbackState: AvatarStatus["playback"];
  private voiceDesired = false;
  private voicePhase: NonNullable<AvatarStatus["voice"]>["phase"] = "idle";
  private voiceError: string | null = null;
  private voiceLevel = 0;
  private speechDirectory = tmpdir();
  configureSpeech(service: SpeechService, directory = tmpdir()) { this.speechService = service; this.speechDirectory = directory; }
  private server: Server | undefined;
  private socket: Socket | undefined;
  private child: ChildProcess | undefined;
  private capabilities: AvatarCapabilities | undefined;
  private pending = new Map<string, Pending>();
  private activeRuns = new Set<string>();
  private bindingEpoch = 0;
  private switching: Promise<AvatarStatus> | undefined;
  private releaseBarrier: Promise<unknown> = Promise.resolve();
  // A null value reserves ownership until Unity reports its actual state.
  private performances = new Map<string, AvatarPerformanceState | null>();
  private dances = new Map<string, DancePlayback>();
  private latestDanceId: string | undefined;
  private starting: Promise<AvatarStatus> | undefined;
  private rejectStartup: ((error: Error) => void) | undefined;
  private listeners = new Set<(status: AvatarStatus) => void>();
  subscribe(listener: (status: AvatarStatus) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
  private changed(): void {
    const status = this.status;
    for (const listener of this.listeners) listener(status);
    this.onDesktopChanged?.();
  }
  private currentState: AvatarStatus = {
    phase: "stopped",
    binding: null,
    error: null,
  };

  private get state(): AvatarStatus { return this.currentState; }
  private set state(value: AvatarStatus) { this.currentState = value; this.changed(); }

  constructor(
    private readonly executable: string,
    private readonly logsDirectory: string,
  ) {}
  get status(): AvatarStatus {
    return { ...this.state, live: this.liveActive, performances: [...this.performances.values()].flatMap(state => state ? [state] : []), busy: this.activeRuns.size > 0 || this.pending.size > 0,
      ...(this.latestDance ? { dance: this.latestDance } : {}),
      voice: { desired: this.voiceDesired, phase: this.voicePhase, error: this.voiceError }, playback: this.playbackState };
  }
  get canPlayManualSpeech(): boolean {
    return this.activeRuns.size === 0 && ![...this.dances.values()].some(dance => !dance.state || !danceTerminal(dance.state.state));
  }
  private get latestDance(): AvatarDanceState | null {
    const active = [...this.dances.values()].find(dance => dance.state && !danceTerminal(dance.state.state));
    return active?.state ?? (this.latestDanceId ? this.dances.get(this.latestDanceId)?.state ?? null : null);
  }
  getDanceFeedback(binding: AvatarBinding, epoch = this.bindingEpoch): AvatarDanceState | null {
    return epoch === this.bindingEpoch && this.matches(binding) && this.latestDance ? { ...this.latestDance } : null;
  }
  private updateDance(id: string, state: AvatarDanceState["state"], error?: string): void {
    const dance = this.dances.get(id);
    if (!dance || (dance.state && danceTerminal(dance.state.state))) return;
    const order = ["accepted", "preparing", "started"];
    if (dance.state && !danceTerminal(state) && order.indexOf(state) < order.indexOf(dance.state.state)) return;
    dance.state = { performanceId: id, toolCallId: dance.toolCallId, actionId: dance.actionId, action: dance.action, state,
      ...(error ? { error: error.slice(0, 4000) } : {}) };
    this.latestDanceId = id;
    this.changed();
  }

  setVoiceState(binding: AvatarBinding, phase: NonNullable<AvatarStatus["voice"]>["phase"], error: string | null, level?: number): void {
    if (!this.matches(binding) || this.state.phase !== "ready") return;
    const changed = phase !== this.voicePhase || error !== this.voiceError || (phase === "error" && this.voiceDesired);
    if (phase === "error") this.voiceDesired = false;
    this.voicePhase = phase;
    this.voiceError = error;
    if (level !== undefined) { this.voiceLevel = level; this.onDesktopChanged?.(); }
    if (changed) this.changed();
  }

  controlPlayback(binding: AvatarBinding, action: "pause" | "resume" | "interrupt"): void {
    if (!this.matches(binding) || this.state.phase !== "ready") return;
    const runId = this.playingRunId;
    if (action === "interrupt") {
      for (const [id, run] of this.dialogueRuns) {
        this.mutedRuns.add(id);
        run.silence();
        this.socket?.write(`${JSON.stringify({ operation: "voice-interrupt", value: id })}\n`);
      }
    } else if (runId) {
      this.socket?.write(`${JSON.stringify({ operation: action === "pause" ? "voice-pause" : "voice-resume", value: runId })}\n`);
    }
  }

  showUserSubtitle(binding: AvatarBinding, text: string): void {
    const socket = this.socket;
    const subtitle = text.trim();
    if (!socket || socket.destroyed || this.state.phase !== "ready" || !this.matches(binding)
      || !subtitle || subtitle.length > 20_000) return;
    // User captions are immediate display events, not actions in the playback queue.
    socket.write(`${JSON.stringify({ type: "user-subtitle", text: subtitle })}\n`);
  }

  clearError(): void { this.state = { ...this.state, error: null }; }

  async start(binding: AvatarBinding): Promise<AvatarStatus> {
    if (this.liveBinding && (binding.threadId !== this.liveBinding.threadId || binding.characterId !== this.liveBinding.characterId)) throw new Error("直播正在占用角色，请先停止直播。");
    const startupPackage = this.packageResolver?.(binding.characterId);
    if (this.matches(binding) && this.state.phase === "ready" && (!startupPackage || this.activePackageId === startupPackage.id))
      return this.status;
    if (this.starting || this.switching) {
      await (this.switching ?? this.starting)!;
      return this.start(binding);
    }
    if (this.state.phase === "ready" && this.socket && !this.socket.destroyed)
      return this.rebind(binding);
    this.stop();
    if (!existsSync(this.executable)) {
      this.state = { phase: "error", binding, error: "未找到 Unity Runtime，请先构建 Windows Player。" };
      throw new Error(this.state.error!);
    }
    this.state = { phase: "starting", binding, error: null };
    mkdirSync(this.logsDirectory, { recursive: true });
    const packageFile = join(this.logsDirectory, "avatar-package.json");
    if (startupPackage) writeFileSync(packageFile, JSON.stringify(startupPackage));
    const pipeName = `katarune-avatar-${randomUUID()}`;
    this.starting = new Promise<AvatarStatus>((resolve, reject) => {
      const timer = setTimeout(
        () => this.fail("Unity 启动或模型加载超时。"),
        60_000,
      );
      const finish = () => {
        clearTimeout(timer);
        this.rejectStartup = undefined;
        resolve(this.status);
      };
      this.rejectStartup = (error) => {
        clearTimeout(timer);
        reject(error);
      };
      const server = createServer((socket) => {
        if (this.socket) {
          socket.destroy();
          return;
        }
        this.socket = socket;
        let buffer = "";
        socket.setEncoding("utf8");
        socket.on("data", (chunk: string) => {
          if (this.socket !== socket) return;
          buffer += chunk;
          if (Buffer.byteLength(buffer) > 2 * 1024 ** 2) {
            this.fail("Unity 返回了过大的消息。");
            return;
          }
          let end: number;
          while ((end = buffer.indexOf("\n")) >= 0) {
            const line = buffer.slice(0, end);
            buffer = buffer.slice(end + 1);
            try {
              const reply = avatarReplySchema.parse(JSON.parse(line));
              if (reply.type === "diagnostic") {
                diagnostic("error", "unity.engine-error", { count: reply.dropped }, { name: reply.error.name, stack: `Error\n${reply.error.frames.join("\n")}` }, { ...this.diagnosticSource, sourceSequence: reply.sequence, timestamp: reply.timestamp });
              } else if (reply.type === "presentation") {
                this.presentation = reply;
              } else if (reply.type === "window-state") {
                this.onWindowState?.(reply);
              } else if (reply.type === "startup-error") {
                this.fail(reply.error);
                return;
              } else if (reply.type === "ready") {
                this.capabilities = reply.capabilities;
                if (this.state.phase === "starting") {
                  this.activePackageId = startupPackage?.id;
                  this.voiceDesired = true;
                  this.voicePhase = "preparing";
                  this.state = { ...this.state, phase: "ready", error: null };
                  socket.write(`${JSON.stringify({ type: "binding", epoch: this.bindingEpoch })}\n`);
                                finish();
                }
              } else if (reply.type === "performance") {
                if (!this.performances.has(reply.performance.performanceId)) continue;
                this.performances.set(reply.performance.performanceId, reply.performance);
                diagnostic(reply.performance.state === "failed" ? "error" : "info", `performance.${reply.performance.state}`, { performanceId: reply.performance.performanceId, toolCallId: reply.performance.toolCallId, bindingEpoch: this.bindingEpoch }, undefined, this.diagnosticSource);
                if (reply.performance.state === "failed") this.state = { ...this.state, error: reply.performance.error || "角色表演失败。" };
              } else if (reply.type === "dance") {
                diagnostic(reply.status === "failed" ? "error" : "info", `dance.${reply.status}`, { performanceId: reply.id, bindingEpoch: this.bindingEpoch }, undefined, this.diagnosticSource);
                const dance = this.dances.get(reply.id);
                if (dance?.actionId === reply.actionId) this.updateDance(reply.id, reply.status, reply.status === "failed" ? reply.error || "舞蹈播放失败。" : undefined);
              } else if (reply.type === "playback") {
                if (!this.activeRuns.has(reply.runId) || this.state.phase !== "ready") continue;
                diagnostic("info", `playback.${reply.state}`, { runId: reply.runId }, undefined, this.diagnosticSource);
                this.playingRunId = reply.active ? reply.runId : this.playingRunId === reply.runId ? null : this.playingRunId;
                this.playbackState = { runId: reply.runId, state: reply.state };
                this.changed();
              } else if (reply.type === "dialogue-completed") {
                this.dialogueRuns.get(reply.runId)?.completed(reply.dialogueId);
              } else if (reply.type === "dialogue-delivery") {
                this.dialogueRuns.get(reply.runId)?.admit(reply.dialogueId, reply.delivery);
              } else if (reply.type === "speech") {
                const request = this.pending.get(reply.id);
                if (!request && !(reply.runId && this.activeRuns.has(reply.runId))) continue;
                if (reply.status === "failed") this.state = { ...this.state, error: reply.error || "桌宠语音播放失败。" };
                if (!request) continue;
                if (reply.status === "started") { request.started?.(); continue; }
                this.pending.delete(reply.id);
                request.cleanup();
                if (reply.status === "completed") request.resolve();
                else request.reject(new Error(reply.error || "语音播放已停止。"));
              } else if (reply.type === "result") {
                if (!reply.ok) this.performances.delete(reply.id);
                const request = this.pending.get(reply.id);
                if (!request) continue;
                this.pending.delete(reply.id);
                request.cleanup();
                if (reply.ok) request.resolve();
                else request.reject(new Error(reply.error || "角色执行失败。"));
              }
            } catch (error) {
              diagnostic("error", "unity.invalid-message", {}, error, this.diagnosticSource);
              this.fail("Unity 控制消息无效。");
              return;
            } finally { this.changed(); }
          }
        });
        socket.on("error", (error) => {
          if (this.socket === socket) diagnostic("error", "unity.connection-failed", {}, error, this.diagnosticSource);
          if (this.socket === socket) this.fail("Unity 连接失败。");
        });
        socket.on("close", () => {
          if (this.socket === socket) this.fail("Unity 已断开。");
        });
      });
      this.server = server;
      server.on("error", () => { if (this.server === server) this.fail("无法建立 Unity 本机连接。"); });
      server.listen(`\\\\.\\pipe\\${pipeName}`, () => {
        if (this.server !== server) return;
        try {
          mkdirSync(this.logsDirectory, { recursive: true });
          this.diagnosticSource = { source: "unity", processInstanceId: randomUUID() };
          const child = spawn(
            this.executable,
            [
              // Start directly in Unity's borderless full-screen mode.
              "-screen-fullscreen",
              "1",
              "-window-mode", "borderless",
              "-nolog",
            ],
            {
              cwd: dirname(this.executable),
              windowsHide: true,
              stdio: "ignore",
              env: { ...process.env, KATARUNE_DIAGNOSTICS_FALLBACK: join(this.logsDirectory, "unity-fallback.jsonl"), KATARUNE_AVATAR_PIPE: pipeName, KATARUNE_CHARACTER_PACKAGE: startupPackage ? packageFile : "" },
            },
          );
          this.child = child;
          child.on("error", (error) => {
            diagnostic("error", "unity.start-failed", {}, error);
            if (this.child === child) this.fail("Unity 无法启动。");
          });
          child.on("exit", (code) => {
            if (this.child === child) diagnostic("error", "unity.exited", { exitCode: code ?? -1 }, undefined, this.diagnosticSource);
            if (this.child === child) this.fail("Unity 已退出。");
          });
        } catch (error) {
          diagnostic("error", "unity.launch-failed", {}, error);
          this.fail("Unity 无法启动或日志目录不可写。");
        }
      });
    });
    const startup = this.starting;
    try {
      return await startup;
    } finally {
      if (this.starting === startup) this.starting = undefined;
    }
  }

  private async rebind(binding: AvatarBinding, packageOverride?: RuntimeCharacterPackage): Promise<AvatarStatus> {
    const socket = this.socket;
    const previousBinding = this.state.binding;
    const previousCapabilities = this.capabilities;
    const pack = packageOverride ?? this.packageResolver?.(binding.characterId);
    const epoch = ++this.bindingEpoch;
    const runs = [...this.dialogueRuns.values()];
    const pending = [...this.pending.values()];
    for (const run of runs) run.cancel();
    for (const request of pending) request.cleanup();
    this.pending.clear();
    this.dialogueRuns.clear();
    this.activeRuns.clear();
    this.performances.clear();
    this.dances.clear(); this.latestDanceId = undefined;
    this.mutedRuns.clear();
    this.playingRunId = null;
    this.playbackState = undefined;
    this.voiceError = null;
    this.voiceLevel = 0;
    this.voicePhase = this.voiceDesired ? "preparing" : "idle";
    this.state = { phase: "switching", binding, error: null };
    const reset = this.request("session-reset", String(epoch), new AbortController().signal);
    this.releaseBarrier = reset.catch(() => {});
    const switching = reset.then(async () => {
      if (epoch !== this.bindingEpoch || this.socket !== socket) throw new Error("桌宠切换已取消。");
      if (pack && (packageOverride || this.activePackageId !== pack.id)) {
        this.capabilities = undefined;
        await this.request("load-package", JSON.stringify(pack), new AbortController().signal);
        if (epoch !== this.bindingEpoch || this.socket !== socket) throw new Error("桌宠切换已取消。");
        this.activePackageId = pack.id;
      }
      if (epoch !== this.bindingEpoch || this.socket !== socket) throw new Error("桌宠切换已取消。");
      this.state = { ...this.state, phase: "ready" };
        return this.status;
    }).catch(error => {
      if (epoch === this.bindingEpoch && this.socket === socket) {
        this.capabilities = previousCapabilities;
        this.state = { phase: "ready", binding: previousBinding, error: error instanceof Error ? error.message : "角色包切换失败。" };
      }
      throw error;
    }).finally(() => {
      for (const request of pending) request.reject(new Error("桌宠已切换会话。"));
      for (const run of runs) void run.dispose().catch(() => {});
      if (this.switching === switching) this.switching = undefined;
    });
    this.switching = switching;
    return switching;
  }

  stop(error = new Error("桌宠控制已停止。")): AvatarStatus {
    this.bindingEpoch++;
    this.activePackageId = undefined;
    this.presentation = null;
    this.starting = undefined;
    this.switching = undefined;
    this.activeRuns.clear();
    const speechRuns = [...this.dialogueRuns.values()];
    for (const run of speechRuns) run.cancel();
    this.dialogueRuns.clear();
    this.mutedRuns.clear();
    this.playingRunId = null;
    this.playbackState = undefined;
    this.voiceDesired = false;
    this.voicePhase = "idle";
    this.voiceError = null;
    this.voiceLevel = 0;
    this.rejectStartup?.(error);
    this.rejectStartup = undefined;
    for (const request of this.pending.values()) {
      request.cleanup();
      request.reject(error);
    }
    this.pending.clear();
    this.performances.clear();
    this.dances.clear(); this.latestDanceId = undefined;
    const socket = this.socket;
    this.socket = undefined;
    socket?.destroy();
    const server = this.server;
    this.server = undefined;
    server?.close();
    const child = this.child;
    this.child = undefined;
    child?.kill();
    for (const run of speechRuns) void run.dispose().catch(() => {});
    this.capabilities = undefined;
    this.state = { phase: "stopped", binding: null, error: null };
    return this.status;
  }

  private fail(message: string): void {
    const binding = this.state.binding;
    for (const [id, dance] of this.dances) if (!dance.state || !danceTerminal(dance.state.state)) this.updateDance(id, "failed", message);
    const dance = this.latestDance;
    this.stop(new Error(message));
    if (dance) {
      this.dances.set(dance.performanceId, { actionId: dance.actionId, action: dance.action, toolCallId: dance.toolCallId, state: dance });
      this.latestDanceId = dance.performanceId;
    }
    this.state = { phase: "error", binding, error: message };
  }

  private matches(binding: AvatarBinding): boolean {
    return (
      this.state.binding?.characterId === binding.characterId &&
      this.state.binding.threadId === binding.threadId
    );
  }

  captureBinding(binding: AvatarBinding): number | null {
    return this.matches(binding) && this.state.phase === "ready" ? this.bindingEpoch : null;
  }

  createTools(binding: AvatarBinding, signal: AbortSignal, epoch = this.bindingEpoch, runId?: string): ToolSet {
    const capabilities = this.capabilities;
    const socket = this.socket;
    if (
      epoch !== this.bindingEpoch ||
      !capabilities ||
      !socket ||
      !this.matches(binding) ||
      this.state.phase !== "ready"
    )
      return {};
    const current = () => {
      if (this.socket !== socket || epoch !== this.bindingEpoch || !this.matches(binding) || this.state.phase !== "ready")
        throw new Error("角色连接已改变。");
    };
    if (!capabilities.actions.length && !capabilities.expressions.length) return {};
    const actions = capabilities.actions.filter(action => action.kind !== "performance" && !action.idle);
    const dances = capabilities.actions.filter(action => action.kind === "performance");
    const inputSchema = avatarPerformSchema.safeExtend({ steps: z.array(avatarStepSchema.extend({
      action: (actions.length ? z.enum(actions.map(actionSelector)).nullish() : z.null().optional())
        .describe("身体动作，只能选择本字段枚举中的动作名称；动作名称不代表同名面部表情。不需要动作时省略或填 null。"),
      expression: (capabilities.expressions.length ? z.enum(capabilities.expressions).nullish() : z.null().optional())
        .describe("面部表情，只能选择本字段枚举中的表情名称，不能照搬 action 的名称。动作不要求搭配表情；没有合适表情时省略或填 null，保持现有表情。"),
    })).min(1).max(32) }).superRefine(({ steps }, ctx) => {
      let previousAction: AvatarCapabilities["actions"][number] | undefined;
      steps.forEach((step, index) => {
        if (step.at === "after_action" && previousAction?.kind === "loop")
          ctx.addIssue({ code: "custom", path: ["steps", index, "at"], message: "不能等待持续姿态，请使用 sentence 或 end 触发。" });
        if (step.action) previousAction = actions.find(action => actionSelector(action) === step.action);
      });
    });
    const exampleAction = actions.find(action => action.kind !== "loop") ?? actions[0];
    const exampleExpression = capabilities.expressions.includes("happy") ? "happy" : capabilities.expressions[0];
    const example = { steps: [{ at: "start", ...(exampleAction ? { action: actionSelector(exampleAction) } : {}),
      ...(exampleExpression ? { expression: exampleExpression } : {}) }] };
    const calls = new Map<string, { operation: string; value: string; result: Promise<string> }>();
    const executeRequest = (operation: string, value: string, abort: AbortSignal, toolCallId: string, dance?: { actionId: string; action: string }) => {
      const prior = calls.get(toolCallId);
      if (prior) {
        if (prior.operation !== operation || prior.value !== value) throw new Error("重复工具调用的参数不一致。");
        return prior.result;
      }
      const result = this.request(operation, value, abort, toolCallId, dance, runId);
      calls.set(toolCallId, { operation, value, result });
      return result;
    };
    return {
      ...(actions.length || capabilities.expressions.length ? {
      avatar_perform: tool({
        description: `为接下来一段正文安排动作和表情，调用后正常输出对白。steps 是步骤列表，每步直接填 action 和/或 expression 名称，不填写 id、when 或内部节点引用。身体动作与面部表情是独立能力，动作存在不代表有同名表情；没有合适表情时省略 expression 或填 null，不必为每个动作搭配表情。调用示例：${JSON.stringify(example)}。at：start=对白开始；sentence=第 sentence 句开始（从1编号，按句末标点或换行分句）；after_action=列表中最近一个带动作的步骤正常完成后；end=对白结束。after_action 只能接在一次性动作后。相同触发条件并行，同身体通道的一次性动作排队。表情统一使用100%强度，不填写权重；表情保持到下次改变。无关字段可省略或填null。持续姿态在对白结束时播完当前循环再退出，一次性动作完整播完。未出现的句子和失败动作的后继步骤跳过。返回接收确认，实际播放由身体执行。可用动作：${actions.map(describeAction).join("；")}。可用表情：${capabilities.expressions.join("、")}。`,
        inputSchema,
        execute: async (input, { toolCallId }): Promise<AvatarPerformResult> => {
          current();
          const resolved = { steps: input.steps.map(step => ({ ...step,
            sentence: step.sentence ?? undefined,
            action: step.action ? actions.find(action => actionSelector(action) === step.action)!.id : null,
          })) };
          const performanceId = await executeRequest("performance", JSON.stringify(resolved), signal, toolCallId);
          current();
          return { status: "accepted", performanceId, steps: resolved.steps.map(step => ({
            action: step.action ? capabilities.actions.find(action => action.id === step.action)!.label : undefined,
            expression: step.expression ?? undefined,
          })) };
        },
      }),
      } : {}),
      avatar_control: tool({
        description: "控制本会话已接收的日常编排或完整演出。cancel 停止目标并释放占用；finish 仅支持日常编排的自然收尾，舞蹈不支持。使用 avatar_perform 或 avatar_play 返回的 performanceId。明确停止成功后，后续新正文恢复出声。",
        inputSchema: avatarControlSchema,
        execute: async ({ performanceId, command }, { toolCallId }) => {
          current();
          const dance = this.dances.get(performanceId);
          if (dance) {
            if (command !== "cancel") throw new Error("舞蹈不支持 finish，请使用 cancel 停止演出。");
            await executeRequest("dance-cancel", performanceId, signal, toolCallId);
          } else {
            if (!this.performances.has(performanceId)) throw new Error("该表演不属于当前角色会话或已经释放。");
            await executeRequest(`performance-${command}`, performanceId, signal, toolCallId);
          }
          return { status: "accepted" as const, performanceId, command };
        },
      }),
      ...(dances.length ? { avatar_play: tool({
        description: `安排一支完整舞蹈，只填写 action。需要引导语时先输出原生正文，再调用本工具；播放器会等待前文播完。返回 accepted 仅表示接收，实际启动与终态由播放器回报。接收后的正文和演出期间的新回复只进入聊天记录，不出声、不占用歌词、不在演后补播。演出期间不能再次安排舞蹈或日常动作；用户要求停止时调用 avatar_control.cancel。可用舞蹈：${dances.map(describeAction).join("；")}。`,
        inputSchema: z.object({ action: z.enum(dances.map(actionSelector)) }),
        execute: async ({ action }, { toolCallId }) => {
          current();
          signal.throwIfAborted();
          const dance = dances.find(dance => actionSelector(dance) === action)!;
          const performanceId = await executeRequest("dance", dance.id, new AbortController().signal, toolCallId, { actionId: dance.id, action: dance.label });
          current();
          return { status: "accepted" as const, performanceId, action: dance.label };
        },
      }) } : {}),
    };
  }

  relay(
    binding: AvatarBinding,
    stream: ReadableStream<UIMessageChunk>,
    signal: AbortSignal,
    epoch = this.bindingEpoch,
    runId = randomUUID(),
  ): ReadableStream<UIMessageChunk> {
    const socket = this.socket;
    if (!socket || epoch !== this.bindingEpoch || !this.matches(binding) || this.state.phase !== "ready")
      return stream;
    const current = () => this.socket === socket && epoch === this.bindingEpoch && this.state.phase === "ready";
    const reader = stream.getReader();
    this.activeRuns.add(runId);
    socket.write(`${JSON.stringify({ type: "run-start", runId })}\n`);
    this.state = { ...this.state, error: null };
    const speech = this.speechService
      ? new AvatarDialogueSpeech(runId, binding.characterId, this.speechService, message => {
        if (current()) socket.write(`${JSON.stringify(message)}\n`);
      }, this.speechDirectory, (error, incidentId) => {
        if (current()) {
          this.state = { ...this.state, error: `桌宠语音合成失败：${toSpeechServiceError(error).message}${incidentId ? `（故障编号：${incidentId}）` : ""}` };
        }
      }) : undefined;
    if (speech) this.dialogueRuns.set(runId, speech);
    const textBlocks = new Map<string, string>();
    const sealText = (id: string) => {
      const text = textBlocks.get(id);
      if (text === undefined) return;
      textBlocks.delete(id);
      if (current()) socket.write(`${JSON.stringify({ type: "dialogue-text", runId, dialogueId: id, text: extractSpokenText(text) })}\n`);
    };
    let released = false;
    let cancellation: Promise<unknown> | undefined;
    const abort = () => {
      if (cancellation) return;
      speech?.cancel();
      cancellation = current()
        ? this.request("run-cancel", runId, new AbortController().signal).catch(() => {})
        : Promise.resolve();
    };
    const release = () => {
      if (released) return;
      released = true;
      this.activeRuns.delete(runId);
      this.changed();
      this.dialogueRuns.delete(runId);
      this.mutedRuns.delete(runId);
      void Promise.all([cancellation, this.releaseBarrier]).then(() => speech?.dispose()).catch(() => {});
      signal.removeEventListener("abort", abort);
    };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    return new ReadableStream<UIMessageChunk>({
      pull: async (controller) => {
        try {
          const chunk = await reader.read();
          if (chunk.done) {
            for (const id of textBlocks.keys()) sealText(id);
            if (current()) speech?.seal();
            // Unity owns playback; acknowledgement only releases borrowed audio files.
            // A completed generation's signal must not cancel its ongoing playback.
            signal.removeEventListener("abort", abort);
            if (current())
              void this.request("drain", runId, new AbortController().signal)
                .catch(() => { if (current()) this.state = { ...this.state, error: "桌宠播放未正常完成。" }; }).finally(release);
            else release();
            reader.releaseLock();
            controller.close();
            return;
          }
          if (current() && !cancellation) {
            await new Promise<void>((resolve) => {
              socket.write(
                `${JSON.stringify({ type: "event", runId, speechEnabled: !!speech && !this.mutedRuns.has(runId), event: chunk.value })}\n`,
                (error) => {
                  if (error && current())
                    this.fail("Unity 事件转发失败。");
                  resolve();
                },
              );
            });
          }
          const event = chunk.value;
          if (event.type === "text-start") textBlocks.set(event.id, "");
          if (event.type === "text-delta" && textBlocks.has(event.id)) textBlocks.set(event.id, textBlocks.get(event.id)! + event.delta);
          if (event.type === "text-end") sealText(event.id);
          if (["finish-step", "finish", "error", "abort"].includes(event.type)) for (const id of textBlocks.keys()) sealText(id);
          if (current() && !this.mutedRuns.has(runId)) speech?.observe(event);
          controller.enqueue(chunk.value);
        } catch (error) {
          abort();
          release();
          reader.releaseLock();
          controller.error(error);
        }
      },
      cancel: async (reason) => {
        abort();
        release();
        await reader.cancel(reason);
      },
    });
  }

  async playSpeech(
    binding: AvatarBinding,
    audio: SpeechServiceResult,
    signal: AbortSignal,
    onStarted: () => void,
    epoch = this.bindingEpoch,
  ): Promise<boolean> {
    signal.throwIfAborted();
    if (!this.canPlayManualSpeech) throw new Error("角色表演期间不能手动朗读。");
    const socket = this.socket;
    if (!socket || epoch !== this.bindingEpoch || !this.matches(binding) || this.state.phase !== "ready") return false;
    if (!["wav", "mp3", "ogg"].includes(audio.format)) throw new Error("Unity 不支持该语音格式。");
    const directory = await mkdtemp(join(this.speechDirectory, "katarune-speech-"));
    const id = randomUUID();
    try {
      const path = join(directory, `speech.${audio.format}`);
      await writeFile(path, audio.audio, { signal });
      signal.throwIfAborted();
      if (this.socket !== socket || epoch !== this.bindingEpoch || !this.matches(binding) || this.state.phase !== "ready") throw new Error("角色连接已改变。");
      if (!this.canPlayManualSpeech) throw new Error("角色表演期间不能手动朗读。");
      await new Promise<void>((resolve, reject) => {
        const abort = () => {
          // Keep the request until Unity acknowledges cancellation, so the file stays valid during decode.
          if (this.socket === socket) socket.write(`${JSON.stringify({
            id: randomUUID(), operation: "speech-stop", value: id,
          })}\n`);
        };
        const timer = setTimeout(() => this.fail("语音播放超时。"), 600_000);
        this.pending.set(id, {
          resolve,
          reject,
          started: onStarted,
          cleanup: () => { clearTimeout(timer); signal.removeEventListener("abort", abort); },
        });
        this.changed();
        signal.addEventListener("abort", abort, { once: true });
        socket.write(`${JSON.stringify({ id, operation: "speech", value: path, text: audio.spokenText ?? "",
          segments: audio.segments ?? [], profilePath: audio.profilePath ?? "" })}\n`);
        if (signal.aborted) abort();
      });
      signal.throwIfAborted();
      return true;
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  }

  private request(
    operation: string,
    value: string,
    signal: AbortSignal,
    toolCallId = "",
    danceAction?: { actionId: string; action: string },
    runId?: string,
  ): Promise<string> {
    signal.throwIfAborted();
    const socket = this.socket;
    if (!socket || (this.state.phase !== "ready" && !((operation === "session-reset" || operation === "load-package") && this.state.phase === "switching")))
      return Promise.reject(new Error("Unity 尚未连接。"));
    const id = randomUUID();
    diagnostic(operation === "dance" || operation === "performance" ? "info" : "debug", `unity.${operation}.requested`, { operationId: id, ...(runId ? { runId } : {}), ...(toolCallId ? { toolCallId } : {}), performanceId: id, bindingEpoch: this.bindingEpoch });
    if (danceAction) {
      if (this.dances.size >= 8) {
        const retired = [...this.dances].find(([, dance]) => dance.state && danceTerminal(dance.state.state))?.[0];
        if (!retired) return Promise.reject(new Error("舞蹈请求过多，请等待当前播放结束。"));
        this.dances.delete(retired);
      }
      this.dances.set(id, { ...danceAction, toolCallId: toolCallId || id, state: null });
    }
    return new Promise<string>((resolve, reject) => {
      const abort = () => {
        this.pending.delete(id);
        if (operation === "performance") this.performances.delete(id);
        this.changed();
        cleanup();
        if (danceAction) this.updateDance(id, "failed", "舞蹈启动已取消。");
        reject(signal.reason ?? new Error("角色请求已取消。"));
      };
      const timer = setTimeout(() => {
        this.fail(operation === "session-reset" ? "桌宠会话切换超时。" : "角色执行超时。");
      }, operation === "session-reset" ? 5_000 : operation === "load-package" || operation === "dance" ? 120_000 : 600_000);
      const cleanup = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
      };
      if (operation === "performance") {
        if (this.performances.size >= 64) {
          const released = [...this.performances].find(([, state]) => state && ["completed", "cancelled", "failed"].includes(state.state))?.[0];
          if (!released) { cleanup(); reject(new Error("角色表演队列已满。")); return; }
          this.performances.delete(released);
        }
        this.performances.set(id, null);
      }
      this.pending.set(id, { resolve: () => { if (danceAction) this.updateDance(id, "accepted"); resolve(id); },
        reject: error => { if (danceAction) this.updateDance(id, "failed", error.message); reject(error); }, cleanup });
      this.changed();
      signal.addEventListener("abort", abort, { once: true });
      socket.write(
        `${JSON.stringify({ id, operation, value, toolCallId, runId })}\n`,
      );
    });
  }
}
