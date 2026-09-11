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
  private speechService?: SpeechService;
  private dialogueRuns = new Map<string, AvatarDialogueSpeech>();
  private speechDirectory = tmpdir();
  configureSpeech(service: SpeechService, directory = tmpdir()) { this.speechService = service; this.speechDirectory = directory; }
  private server: Server | undefined;
  private socket: Socket | undefined;
  private child: ChildProcess | undefined;
  private capabilities: AvatarCapabilities | undefined;
  private pending = new Map<string, Pending>();
  private activeStreams = 0;
  private activeInstructions = new Set<string>();
  private starting: Promise<AvatarStatus> | undefined;
  private rejectStartup: ((error: Error) => void) | undefined;
  private state: AvatarStatus = {
    phase: "stopped",
    binding: null,
    error: null,
  };

  constructor(
    private readonly executable: string,
    private readonly logsDirectory: string,
  ) {}
  get status(): AvatarStatus {
    return { ...this.state, busy: this.activeStreams > 0 || this.pending.size > 0 || this.activeInstructions.size > 0 };
  }

  async start(binding: AvatarBinding): Promise<AvatarStatus> {
    if (this.matches(binding) && this.state.phase === "ready")
      return this.status;
    if (this.starting) {
      if (!this.matches(binding)) throw new Error("Unity 正在连接其他会话。");
      return this.starting;
    }
    if (
      this.pending.size > 0 ||
      this.activeStreams > 0 ||
      this.activeInstructions.size > 0
    )
      throw new Error("角色仍在执行，请完成后再切换会话。");
    this.stop();
    if (!existsSync(this.executable))
      throw new Error("未找到 Unity Runtime，请先构建 Windows Player。");
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
              if (reply.type === "ready") {
                this.capabilities = reply.capabilities;
                this.state = { phase: "ready", binding, error: null };
                finish();
              } else if (reply.type === "dialogue-completed") {
                this.dialogueRuns.get(reply.runId)?.completed(reply.dialogueId);
              } else if (reply.type === "speech") {
                const request = this.pending.get(reply.id);
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
            }
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
      server.on("error", () => this.fail("无法建立 Unity 本机连接。"));
      server.listen(`\\\\.\\pipe\\${pipeName}`, () => {
        if (this.server !== server) return;
        try {
          mkdirSync(this.logsDirectory, { recursive: true });
          const child = spawn(
            this.executable,
            [
              // Override Unity's remembered window mode from earlier builds.
              "-screen-fullscreen",
              "1",
              "-window-mode",
              "borderless",
              "-logFile",
              join(this.logsDirectory, "avatar.log"),
            ],
            {
              cwd: dirname(this.executable),
              windowsHide: false,
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
    try {
      return await this.starting;
    } finally {
      this.starting = undefined;
    }
  }

  stop(error = new Error("桌宠控制已停止。")): AvatarStatus {
    const speechRuns = [...this.dialogueRuns.values()];
    for (const run of speechRuns) run.cancel();
    this.dialogueRuns.clear();
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

  createTools(binding: AvatarBinding, signal: AbortSignal): ToolSet {
    const capabilities = this.capabilities;
    const socket = this.socket;
    if (
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
      if (this.socket !== socket || !this.matches(binding))
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
  ): ReadableStream<UIMessageChunk> {
    const socket = this.socket;
    if (!socket || !this.matches(binding) || this.state.phase !== "ready")
      return stream;
    const reader = stream.getReader();
    this.activeStreams++;
    const runId = randomUUID();
    const speech = this.speechService
      ? new AvatarDialogueSpeech(runId, binding.characterId, this.speechService, message => {
        if (this.socket === socket) socket.write(`${JSON.stringify(message)}\n`);
      }, this.speechDirectory) : undefined;
    if (speech) this.dialogueRuns.set(runId, speech);
    let released = false;
    let cancellation: Promise<unknown> | undefined;
    const abort = () => {
      if (cancellation) return;
      speech?.cancel();
      cancellation = this.socket === socket
        ? this.request("run-cancel", runId, new AbortController().signal).catch(() => {})
        : Promise.resolve();
    };
    const release = () => {
      if (released) return;
      released = true;
      this.activeStreams--;
      this.dialogueRuns.delete(runId);
      void (cancellation ?? Promise.resolve()).then(() => speech?.dispose()).catch(() => {});
      signal.removeEventListener("abort", abort);
    };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    return new ReadableStream<UIMessageChunk>({
      pull: async (controller) => {
        try {
          const chunk = await reader.read();
          if (chunk.done) {
            speech?.seal();
            // Unity owns playback; acknowledgement only releases borrowed audio files.
            // A completed generation's signal must not cancel its ongoing playback.
            signal.removeEventListener("abort", abort);
            if (this.socket === socket)
              void this.request("drain", "", new AbortController().signal)
                .catch(() => {}).finally(release);
            else release();
            reader.releaseLock();
            controller.close();
            return;
          }
          if (this.socket === socket && !cancellation) {
            await new Promise<void>((resolve) => {
              socket.write(
                `${JSON.stringify({ type: "event", runId, speechEnabled: !!speech, event: chunk.value })}\n`,
                (error) => {
                  if (error && this.socket === socket)
                    this.fail("Unity 事件转发失败。");
                  resolve();
                },
              );
            });
          }
          speech?.observe(chunk.value);
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
  ): Promise<boolean> {
    signal.throwIfAborted();
    if (this.activeStreams > 0) throw new Error("角色表演期间不能手动朗读。");
    const socket = this.socket;
    if (!socket || !this.matches(binding) || this.state.phase !== "ready") return false;
    if (!["wav", "mp3", "ogg"].includes(audio.format)) throw new Error("Unity 不支持该语音格式。");
    const directory = await mkdtemp(join(this.speechDirectory, "katarune-speech-"));
    const id = randomUUID();
    try {
      const path = join(directory, `speech.${audio.format}`);
      await writeFile(path, audio.audio, { signal });
      signal.throwIfAborted();
      if (this.socket !== socket || !this.matches(binding)) throw new Error("角色连接已改变。");
      if (this.activeStreams > 0) throw new Error("角色表演期间不能手动朗读。");
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
    if (!socket || this.state.phase !== "ready")
      return Promise.reject(new Error("Unity 尚未连接。"));
    const id = randomUUID();
    return new Promise<string>((resolve, reject) => {
      const abort = () => {
        this.pending.delete(id);
        this.activeInstructions.delete(id);
        cleanup();
        reject(signal.reason ?? new Error("角色请求已取消。"));
      };
      const timer = setTimeout(() => this.fail("角色执行超时。"), 600_000);
      const cleanup = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
      };
      this.pending.set(id, { resolve: () => resolve(id), reject, cleanup });
      if (operation === "action" || operation === "expression")
        this.activeInstructions.add(id);
      signal.addEventListener("abort", abort, { once: true });
      socket.write(
        `${JSON.stringify({ id, operation, value, allowSpeech, toolCallId })}\n`,
      );
    });
  }
}
