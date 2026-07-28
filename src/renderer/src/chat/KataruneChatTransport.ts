import { AssistantChatTransport } from "@assistant-ui/react-ai-sdk";
import type { UIMessage } from "ai";
import type { FrontendTools } from "../../../shared/ipc";

interface PreparedChatRequest {
  readonly id: string;
  readonly messages: unknown[];
  readonly tools: FrontendTools;
}

function parsePreparedRequest(body: BodyInit | null | undefined): PreparedChatRequest {
  if (typeof body !== "string") {
    throw new Error("聊天请求缺少消息内容。");
  }

  const value: unknown = JSON.parse(body);
  if (
    typeof value !== "object" ||
    value === null ||
    !("id" in value) ||
    typeof value.id !== "string" ||
    value.id.length === 0 ||
    !("messages" in value) ||
    !Array.isArray(value.messages) ||
    !("tools" in value) ||
    typeof value.tools !== "object" ||
    value.tools === null ||
    Array.isArray(value.tools)
  ) {
    throw new Error("聊天请求缺少线程、消息或前端工具定义。");
  }

  return {
    id: value.id,
    messages: value.messages,
    tools: value.tools as FrontendTools,
  };
}

export class KataruneChatTransport extends AssistantChatTransport<UIMessage> {
  public constructor(characterId: string) {
    super({
      api: "katarune://chat",
      fetch: async (_input, init) => {
        const prepared = parsePreparedRequest(init?.body);
        const requestId = crypto.randomUUID();
        const abortSignal = init?.signal;
        let finished = false;
        let controller: ReadableStreamDefaultController<Uint8Array> | undefined;

        const cleanup = (): void => {
          if (finished) return;
          finished = true;
          abortSignal?.removeEventListener("abort", handleAbort);
        };
        const handleAbort = (): void => {
          if (finished) return;
          window.katarune.cancelChatStream(requestId);
          controller?.error(new DOMException("聊天回复已取消。", "AbortError"));
          cleanup();
        };

        const body = new ReadableStream<Uint8Array>({
          start(streamController) {
            controller = streamController;
            if (abortSignal?.aborted === true) {
              handleAbort();
              return;
            }
            abortSignal?.addEventListener("abort", handleAbort, { once: true });
            window.katarune.startChatStream(
              {
                requestId,
                threadId: prepared.id,
                characterId,
                messages: prepared.messages,
                frontendTools: prepared.tools,
              },
              (frame) => {
                if (finished) return;
                if (frame.type === "data") {
                  streamController.enqueue(frame.data);
                  return;
                }
                if (frame.type === "end") {
                  streamController.close();
                  cleanup();
                  return;
                }
                streamController.error(new Error(frame.message));
                cleanup();
              },
            );
          },
          pull() {
            if (!finished) window.katarune.pullChatStream(requestId);
          },
          cancel() {
            if (!finished) window.katarune.cancelChatStream(requestId);
            cleanup();
          },
        });

        return new Response(body, {
          status: 200,
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
          },
        });
      },
    });
  }

  public override async reconnectToStream(): Promise<null> {
    return null;
  }
}
