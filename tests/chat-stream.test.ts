import { describe, expect, it, vi } from "vitest";
import type { ChatService } from "../src/main/ai/chatService";
import {
  ChatStreamRegistry,
  startChatStream,
  type ChatStreamPort,
} from "../src/main/ai/chatStream";
import type { ChatStreamRequest } from "../src/shared/ipc";

const request: ChatStreamRequest = {
  requestId: "00000000-0000-4000-8000-000000000003",
  threadId: "thread-1",
  characterId: "00000000-0000-4000-8000-000000000001",
  frontendTools: {},
  messages: [],
};

class FakePort implements ChatStreamPort {
  public readonly sent: unknown[] = [];
  public closed = false;
  private messageListener: ((event: { data: unknown }) => void) | undefined;
  private closeListener: (() => void) | undefined;

  public on(
    event: "message" | "close",
    listener: ((event: { data: unknown }) => void) | (() => void),
  ): void {
    if (event === "message") {
      this.messageListener = listener as (event: { data: unknown }) => void;
    } else {
      this.closeListener = listener as () => void;
    }
  }

  public postMessage(message: unknown): void {
    this.sent.push(message);
  }

  public start(): void {}

  public close(): void {
    if (this.closed) return;
    this.closed = true;
    this.closeListener?.();
  }

  public receive(data: unknown): void {
    this.messageListener?.({ data });
  }
}

async function flushTasks(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

describe("chat stream pull bridge", () => {
  it("emits at most one response chunk for each pull", async () => {
    const chatService: ChatService = {
      createResponse: async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array([1]));
              controller.enqueue(new Uint8Array([2]));
              controller.close();
            },
          }),
        ),
      generateTitle: async () => ({ title: "标题" }),
    };
    const port = new FakePort();
    startChatStream({ chatService, request, port });

    port.receive({ type: "pull" });
    await flushTasks();
    expect(port.sent).toEqual([
      { type: "data", data: new Uint8Array([1]) },
    ]);

    port.receive({ type: "pull" });
    await flushTasks();
    expect(port.sent).toEqual([
      { type: "data", data: new Uint8Array([1]) },
      { type: "data", data: new Uint8Array([2]) },
    ]);

    port.receive({ type: "pull" });
    await flushTasks();
    expect(port.sent.at(-1)).toEqual({ type: "end" });
    expect(port.closed).toBe(true);
  });

  it("aborts the model stream when cancelled", async () => {
    let signal: AbortSignal | undefined;
    const chatService: ChatService = {
      createResponse: vi.fn(async (_request, abortSignal) => {
        signal = abortSignal;
        return new Response(new ReadableStream());
      }),
      generateTitle: async () => ({ title: "标题" }),
    };
    const port = new FakePort();
    startChatStream({ chatService, request, port });
    await flushTasks();

    port.receive({ type: "cancel" });

    expect(signal?.aborted).toBe(true);
    expect(port.closed).toBe(true);
  });

  it("rejects invalid control frames without exposing internal errors", async () => {
    const chatService: ChatService = {
      createResponse: async () => new Response(new ReadableStream()),
      generateTitle: async () => ({ title: "标题" }),
    };
    const port = new FakePort();
    startChatStream({ chatService, request, port });

    port.receive({ type: "resume" });
    await flushTasks();

    expect(port.sent).toEqual([
      { type: "error", message: "聊天流控制消息无效。" },
    ]);
    expect(port.closed).toBe(true);
  });
});

describe("chat stream registry", () => {
  it("cancels only streams belonging to the selected thread", () => {
    const registry = new ChatStreamRegistry();
    const closeFirst = vi.fn();
    const closeSecond = vi.fn();
    const closeOtherCharacter = vi.fn();

    registry.register({
      senderId: 1,
      requestId: "request-1",
      characterId: "character-1",
      threadId: "thread-1",
      close: closeFirst,
    });
    registry.register({
      senderId: 1,
      requestId: "request-2",
      characterId: "character-1",
      threadId: "thread-2",
      close: closeSecond,
    });
    registry.register({
      senderId: 1,
      requestId: "request-3",
      characterId: "character-2",
      threadId: "thread-1",
      close: closeOtherCharacter,
    });

    registry.cancelThread("character-1", "thread-1");

    expect(closeFirst).toHaveBeenCalledOnce();
    expect(closeSecond).not.toHaveBeenCalled();
    expect(closeOtherCharacter).not.toHaveBeenCalled();
  });

  it("cancels streams by character or sender and removes closed entries", () => {
    const registry = new ChatStreamRegistry();
    const closeFirst = vi.fn();
    const closeSecond = vi.fn();
    const closeThird = vi.fn();
    const unregisterFirst = registry.register({
      senderId: 1,
      requestId: "request-1",
      characterId: "character-1",
      threadId: "thread-1",
      close: closeFirst,
    });
    registry.register({
      senderId: 1,
      requestId: "request-2",
      characterId: "character-2",
      threadId: "thread-2",
      close: closeSecond,
    });
    registry.register({
      senderId: 2,
      requestId: "request-3",
      characterId: "character-3",
      threadId: "thread-3",
      close: closeThird,
    });

    expect(registry.size).toBe(3);
    registry.cancelCharacter("character-1");
    expect(closeFirst).toHaveBeenCalledOnce();
    expect(closeSecond).not.toHaveBeenCalled();
    expect(closeThird).not.toHaveBeenCalled();

    unregisterFirst();
    expect(registry.size).toBe(2);

    registry.cancelSender(1);
    expect(closeSecond).toHaveBeenCalledOnce();
    expect(closeThird).not.toHaveBeenCalled();
  });

  it("closes a duplicate sender request before replacing it", () => {
    const registry = new ChatStreamRegistry();
    const closeFirst = vi.fn();
    const closeReplacement = vi.fn();

    registry.register({
      senderId: 1,
      requestId: "request-1",
      characterId: "character-1",
      threadId: "thread-1",
      close: closeFirst,
    });
    registry.register({
      senderId: 1,
      requestId: "request-1",
      characterId: "character-2",
      threadId: "thread-2",
      close: closeReplacement,
    });

    expect(closeFirst).toHaveBeenCalledOnce();
    expect(closeReplacement).not.toHaveBeenCalled();
    expect(registry.size).toBe(1);
  });
});
