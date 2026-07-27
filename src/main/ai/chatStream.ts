import {
  chatStreamControlFrameSchema,
  chatStreamResponseFrameSchema,
  type ChatStreamRequest,
} from "../../shared/ipc";
import type { ChatService } from "./chatService";
import { sanitizeChatError } from "./chatService";

export interface ChatStreamPort {
  on(event: "message", listener: (event: { data: unknown }) => void): void;
  on(event: "close", listener: () => void): void;
  postMessage(message: unknown): void;
  start(): void;
  close(): void;
}

interface StartChatStreamOptions {
  readonly chatService: ChatService;
  readonly request: ChatStreamRequest;
  readonly port: ChatStreamPort;
  readonly onClose?: () => void;
}

interface ActiveChatStream {
  readonly senderId: number;
  readonly requestId: string;
  readonly characterId: string;
  readonly threadId: string;
  readonly close: () => void;
}

export class ChatStreamRegistry {
  private readonly streams = new Map<string, ActiveChatStream>();

  public get size(): number {
    return this.streams.size;
  }

  public register(stream: ActiveChatStream): () => void {
    const key = this.createKey(stream.senderId, stream.requestId);
    this.streams.get(key)?.close();
    this.streams.set(key, stream);

    return () => {
      if (this.streams.get(key) === stream) this.streams.delete(key);
    };
  }

  public cancelThread(characterId: string, threadId: string): void {
    this.cancelMatching(
      (stream) =>
        stream.characterId === characterId && stream.threadId === threadId,
    );
  }

  public cancelCharacter(characterId: string): void {
    this.cancelMatching((stream) => stream.characterId === characterId);
  }

  public cancelSender(senderId: number): void {
    this.cancelMatching((stream) => stream.senderId === senderId);
  }

  private createKey(senderId: number, requestId: string): string {
    return `${senderId}:${requestId}`;
  }

  private cancelMatching(
    predicate: (stream: ActiveChatStream) => boolean,
  ): void {
    for (const stream of [...this.streams.values()]) {
      if (predicate(stream)) stream.close();
    }
  }
}

export function startChatStream({
  chatService,
  request,
  port,
  onClose,
}: StartChatStreamOptions): () => void {
  const abortController = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let pendingPulls = 0;
  let draining = false;
  let closed = false;

  const close = (): void => {
    if (closed) return;
    closed = true;
    abortController.abort();
    void reader?.cancel().catch(() => undefined);
    port.close();
    onClose?.();
  };

  const post = (frame: unknown): void => {
    if (closed) return;
    port.postMessage(chatStreamResponseFrameSchema.parse(frame));
  };

  const responsePromise = chatService
    .createResponse(request, abortController.signal)
    .then((response) => {
      if (response.body === null) {
        throw new Error("AI SDK returned an empty chat stream.");
      }
      reader = response.body.getReader();
      return reader;
    });

  const drain = async (): Promise<void> => {
    if (draining || closed) return;
    draining = true;
    try {
      const streamReader = await responsePromise;
      while (pendingPulls > 0 && !closed) {
        pendingPulls -= 1;
        const result = await streamReader.read();
        if (result.done) {
          post({ type: "end" });
          close();
          return;
        }
        post({ type: "data", data: result.value });
      }
    } catch (error) {
      if (!closed) {
        post({ type: "error", message: sanitizeChatError(error) });
        close();
      }
    } finally {
      draining = false;
      if (pendingPulls > 0 && !closed) void drain();
    }
  };

  port.on("message", (event) => {
    const parsed = chatStreamControlFrameSchema.safeParse(event.data);
    if (!parsed.success) {
      post({ type: "error", message: "聊天流控制消息无效。" });
      close();
      return;
    }
    if (parsed.data.type === "cancel") {
      close();
      return;
    }
    pendingPulls += 1;
    void drain();
  });
  port.on("close", close);
  port.start();
  void responsePromise.catch((error: unknown) => {
    if (!closed) {
      post({ type: "error", message: sanitizeChatError(error) });
      close();
    }
  });

  return close;
}
