import { randomUUID } from "node:crypto";
import { createServer, type Server, type Socket } from "node:net";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
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
  resolve: () => void;
  reject: (error: Error) => void;
  cleanup: () => void;
};

export class AvatarService {
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
    return { ...this.state };
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
            ["-logFile", join(this.logsDirectory, "avatar.log")],
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
    try {
      return await this.starting;
    } finally {
      this.starting = undefined;
    }
  }

  stop(error = new Error("桌宠控制已停止。")): AvatarStatus {
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
      const actionId = await this.request(
        operation,
        value,
        signal,
        allowSpeech,
        toolCallId,
      );
      return operation === "action"
        ? { actionId, status: "accepted" as const }
        : { expressionId: actionId, status: "accepted" as const };
    };
    const tools: ToolSet = {};
    if (capabilities.expressions.length)
      tools.set_expression = tool({
        description:
          "编排角色的整体表情状态。Unity 接受后立即返回 accepted，并在此前对白实际播放完成、时间线运行到该节点时切换。可用值来自当前模型。",
        inputSchema: z.object({ expression: z.enum(capabilities.expressions) }),
        execute: ({ expression }, { toolCallId }) =>
          execute("expression", expression, toolCallId),
      });
    if (capabilities.actions.length)
      tools.avatar_action = tool({
        description: `提交动作，Unity 接受后立即返回 accepted，不等待播放结束。可用动作：${capabilities.actions.map((a) => `${a.id}（${a.label}）`).join("；")}。allowSpeech 默认为 true，可边说边做；false 仅在该动作实际播放期间暂停对白播放，结束后恢复。两种情况都不阻塞后续思考与输出，互斥动作按顺序播放。`,
        inputSchema: z.object({
          action: z.enum(capabilities.actions.map((a) => a.id)),
          allowSpeech: z.boolean().default(true),
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
    let released = false;
    const abort = () => {
      if (this.socket === socket) this.fail("角色输出已取消。");
    };
    const release = () => {
      if (released) return;
      released = true;
      this.activeStreams--;
      signal.removeEventListener("abort", abort);
    };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    return new ReadableStream<UIMessageChunk>({
      pull: async (controller) => {
        try {
          const chunk = await reader.read();
          if (chunk.done) {
            // Playback completion holds the next user turn, never the Agent's tool steps.
            if (this.socket === socket)
              await this.request("drain", "", signal).catch(() => {});
            release();
            reader.releaseLock();
            controller.close();
            return;
          }
          if (this.socket === socket) {
            await new Promise<void>((resolve) => {
              socket.write(
                `${JSON.stringify({ type: "event", event: chunk.value })}\n`,
                (error) => {
                  if (error && this.socket === socket)
                    this.fail("Unity 事件转发失败。");
                  resolve();
                },
              );
            });
          }
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
      const abort = () => this.fail("角色请求已取消。");
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
