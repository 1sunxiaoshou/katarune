import type { AvatarPresentation, AvatarWindowReport, AvatarSubtitle } from "../../shared/avatarDesktop";
import { randomUUID } from "node:crypto";
import { createServer, type Server, type Socket } from "node:net";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import type { SpeechServiceResult } from "../speech/ttsService";
import type { SpeechService } from "../speech/ttsService";
import { AvatarDialogueSpeech } from "./avatarDialogueSpeech";
import { dirname, join } from "node:path";
import { tool, type ToolSet, type UIMessageChunk } from "ai";
import { z } from "zod";
import {
  avatarReplySchema,
  type AvatarBinding,
  type AvatarCapabilities,
  type AvatarStatus,
} from "../../shared/avatar";

type Pending = {
  started?: () => void;
  resolve: () => void;
  reject: (error: Error) => void;
  cleanup: () => void;
};

function describeAction(action: AvatarCapabilities["actions"][number]): string {
  const duration = action.durationSeconds;
  const timing =
    duration !== undefined && duration > 0
      ? `，约 ${Math.max(1, Math.round(duration))} 秒`
      : "";
  return `${action.id}（${action.label}${timing}）`;
}

export class AvatarService {
  onOpenChat: (() => void) | undefined;
  onWindowState: ((state: AvatarWindowReport) => void) | undefined;
  onDesktopChanged: (() => void) | undefined;
  presentation: AvatarPresentation | null = null;
  subtitle: AvatarSubtitle | null = null;
  get desktopCapabilities() { return this.capabilities ?? null; }
  get inputLevel() { return this.voiceLevel; }
  setVoiceDesired(enabled: boolean): void {
    this.voiceDesired = enabled; this.voicePhase = enabled ? "preparing" : "idle";
    this.voiceError = null; this.changed();
  }
  desktopCommand(operation: string, value: string): Promise<string> {
    return this.request(operation, value, new AbortController().signal);
  }
  sendWindowLayout(value: unknown): void {
    this.socket?.write(`${JSON.stringify({ type: "window-layout", value: JSON.stringify(value) })}\n`);
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
  private activeInstructions = new Set<string>();
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
    return { ...this.state, busy: this.activeRuns.size > 0 || this.pending.size > 0 || this.activeInstructions.size > 0,
      voice: { desired: this.voiceDesired, phase: this.voicePhase, error: this.voiceError }, playback: this.playbackState };
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
      this.subtitle = null; this.changed();
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
    if (this.matches(binding) && this.state.phase === "ready")
      return this.status;
    if (this.starting || this.switching) {
      this.state = { ...this.state, binding };
      return (this.switching ?? this.starting)!;
    }
    if (this.state.phase === "ready" && this.socket && !this.socket.destroyed)
      return this.rebind(binding);
    this.stop();
    if (!existsSync(this.executable)) {
      this.state = { phase: "error", binding, error: "未找到 Unity Runtime，请先构建 Windows Player。" };
      throw new Error(this.state.error!);
    }
    this.state = { phase: "starting", binding, error: null };
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
          if (Buffer.byteLength(buffer) > 65_536) {
            this.fail("Unity 返回了过大的消息。");
            return;
          }
          let end: number;
          while ((end = buffer.indexOf("\n")) >= 0) {
            const line = buffer.slice(0, end);
            buffer = buffer.slice(end + 1);
            try {
              const reply = avatarReplySchema.parse(JSON.parse(line));
              if (reply.type === "presentation") {
                this.presentation = reply;
              } else if (reply.type === "window-state") {
                this.onWindowState?.(reply);
              } else if (reply.type === "subtitle") {
                if (reply.epoch === this.bindingEpoch && this.state.phase === "ready"
                    && (!reply.text || !this.mutedRuns.has(reply.runId))
                    && (!reply.runId || this.activeRuns.has(reply.runId) || this.pending.has(reply.runId) || (!reply.text && this.subtitle?.runId === reply.runId)))
                  this.subtitle = reply;
              } else if (reply.type === "startup-error") {
                this.fail(reply.error);
                return;
              } else if (reply.type === "ready") {
                this.capabilities = reply.capabilities;
                if (this.state.phase === "starting") {
                  this.voiceDesired = true;
                  this.voicePhase = "preparing";
                  this.state = { ...this.state, phase: "ready", error: null };
                  socket.write(`${JSON.stringify({ type: "binding", epoch: this.bindingEpoch })}\n`);
                                finish();
                }
              } else if (reply.type === "playback") {
                if (!this.activeRuns.has(reply.runId) || this.state.phase !== "ready") continue;
                this.playingRunId = reply.active ? reply.runId : this.playingRunId === reply.runId ? null : this.playingRunId;
                this.playbackState = { runId: reply.runId, state: reply.state };
                this.changed();
              } else if (reply.type === "dialogue-completed") {
                this.dialogueRuns.get(reply.runId)?.completed(reply.dialogueId);
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
              } else if (
                reply.type === "action" ||
                reply.type === "expression"
              ) {
                if (!this.activeInstructions.has(reply.id)) continue;
                if (reply.type === "expression" || reply.status !== "started")
                  this.activeInstructions.delete(reply.id);
                if (
                  reply.status === "failed" ||
                  (reply.type === "action" && reply.status === "cancelled")
                )
                  this.state = {
                    ...this.state,
                    error: reply.error || "动作未完成。",
                  };
              } else {
                if (!reply.ok) this.activeInstructions.delete(reply.id);
                const request = this.pending.get(reply.id);
                if (!request) continue;
                this.pending.delete(reply.id);
                request.cleanup();
                if (reply.ok) request.resolve();
                else request.reject(new Error(reply.error || "角色执行失败。"));
              }
            } catch {
              this.fail("Unity 控制消息无效。");
              return;
            } finally { this.changed(); }
          }
        });
        socket.on("error", () => {
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
          const child = spawn(
            this.executable,
            [
              // Override Unity's remembered window mode from earlier builds.
              "-screen-fullscreen",
              "0",
              "-screen-width", "480",
              "-screen-height", "800",
              "-logFile",
              join(this.logsDirectory, "avatar.log"),
            ],
            {
              cwd: dirname(this.executable),
              windowsHide: true,
              stdio: "ignore",
              env: { ...process.env, KATARUNE_AVATAR_PIPE: pipeName },
            },
          );
          this.child = child;
          child.on("error", () => {
            if (this.child === child) this.fail("Unity 无法启动。");
          });
          child.on("exit", () => {
            if (this.child === child) this.fail("Unity 已退出。");
          });
        } catch {
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

  private async rebind(binding: AvatarBinding): Promise<AvatarStatus> {
    const socket = this.socket;
    const epoch = ++this.bindingEpoch;
    this.subtitle = null;
    const runs = [...this.dialogueRuns.values()];
    const pending = [...this.pending.values()];
    for (const run of runs) run.cancel();
    for (const request of pending) request.cleanup();
    this.pending.clear();
    this.dialogueRuns.clear();
    this.activeRuns.clear();
    this.activeInstructions.clear();
    this.mutedRuns.clear();
    this.playingRunId = null;
    this.playbackState = undefined;
    this.voiceError = null;
    this.voiceLevel = 0;
    this.voicePhase = this.voiceDesired ? "preparing" : "idle";
    this.state = { phase: "switching", binding, error: null };
    const reset = this.request("session-reset", String(epoch), new AbortController().signal);
    this.releaseBarrier = reset.catch(() => {});
    const switching = reset.then(() => {
      if (epoch !== this.bindingEpoch || this.socket !== socket) throw new Error("桌宠切换已取消。");
      this.state = { ...this.state, phase: "ready" };
        return this.status;
    }).catch(error => {
      if (epoch === this.bindingEpoch) this.fail("桌宠会话切换失败，请重试。");
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
    this.subtitle = null; this.presentation = null;
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
    this.activeInstructions.clear();
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
    this.stop(new Error(message));
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

  createTools(binding: AvatarBinding, signal: AbortSignal, epoch = this.bindingEpoch): ToolSet {
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
    const execute = async (
      operation: string,
      value: string,
      toolCallId: string,
      allowSpeech = true,
    ) => {
      if (this.socket !== socket || epoch !== this.bindingEpoch || !this.matches(binding) || this.state.phase !== "ready")
        throw new Error("角色连接已改变。");
      await this.request(
        operation,
        value,
        signal,
        allowSpeech,
        toolCallId,
      );
      return { ok: true as const };
    };
    const tools: ToolSet = {};
    if (capabilities.expressions.length)
      tools.set_expression = tool({
        description:
          "用你的表情表达情绪。选择最符合当前感受和语境的表情。",
        inputSchema: z.object({
          expression: z
            .enum(capabilities.expressions)
            .describe("你要呈现的表情"),
        }),
        execute: ({ expression }, { toolCallId }) =>
          execute("expression", expression, toolCallId),
      });
    if (capabilities.actions.length)
      tools.avatar_action = tool({
        description: `用你的身体做一个动作。选择符合当前表达和情境的动作。可用动作：${capabilities.actions.map(describeAction).join("；")}。`,
        inputSchema: z.object({
          action: z
            .enum(capabilities.actions.map((a) => a.id))
            .describe("你要做的动作"),
          allowSpeech: z
            .boolean()
            .default(true)
            .describe("做动作时是否同时说话"),
        }),
        execute: ({ action, allowSpeech }, { toolCallId }) =>
          execute("action", action, toolCallId, allowSpeech),
      });
    return tools;
  }

  relay(
    binding: AvatarBinding,
    stream: ReadableStream<UIMessageChunk>,
    signal: AbortSignal,
    epoch = this.bindingEpoch,
  ): ReadableStream<UIMessageChunk> {
    const socket = this.socket;
    if (!socket || epoch !== this.bindingEpoch || !this.matches(binding) || this.state.phase !== "ready")
      return stream;
    const current = () => this.socket === socket && epoch === this.bindingEpoch && this.state.phase === "ready";
    const reader = stream.getReader();
    const runId = randomUUID();
    this.activeRuns.add(runId);
    this.state = { ...this.state, error: null };
    const speech = this.speechService
      ? new AvatarDialogueSpeech(runId, binding.characterId, this.speechService, message => {
        if (current()) socket.write(`${JSON.stringify(message)}\n`);
      }, this.speechDirectory, () => {
        if (current()) this.state = { ...this.state, error: "桌宠语音合成失败，请检查模型和音色后重试。" };
      }) : undefined;
    if (speech) this.dialogueRuns.set(runId, speech);
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
          if (current() && !this.mutedRuns.has(runId)) speech?.observe(chunk.value);
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
    if (this.activeRuns.size > 0) throw new Error("角色表演期间不能手动朗读。");
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
      if (this.activeRuns.size > 0) throw new Error("角色表演期间不能手动朗读。");
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
    allowSpeech = true,
    toolCallId = "",
  ): Promise<string> {
    signal.throwIfAborted();
    const socket = this.socket;
    if (!socket || (this.state.phase !== "ready" && !(operation === "session-reset" && this.state.phase === "switching")))
      return Promise.reject(new Error("Unity 尚未连接。"));
    const id = randomUUID();
    return new Promise<string>((resolve, reject) => {
      const abort = () => {
        this.pending.delete(id);
        this.activeInstructions.delete(id);
        this.changed();
        cleanup();
        reject(signal.reason ?? new Error("角色请求已取消。"));
      };
      const timer = setTimeout(() => this.fail(operation === "session-reset" ? "桌宠会话切换超时。" : "角色执行超时。"), operation === "session-reset" ? 5_000 : 600_000);
      const cleanup = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
      };
      this.pending.set(id, { resolve: () => resolve(id), reject, cleanup });
      if (operation === "action" || operation === "expression")
        this.activeInstructions.add(id);
      this.changed();
      signal.addEventListener("abort", abort, { once: true });
      socket.write(
        `${JSON.stringify({ id, operation, value, allowSpeech, toolCallId })}\n`,
      );
    });
  }
}
