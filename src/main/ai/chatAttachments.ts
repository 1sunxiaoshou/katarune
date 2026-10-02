import {
  tool,
  type Experimental_DownloadFunction,
  type ToolSet,
  type UIMessage,
} from "ai";
import { z } from "zod";
import {
  CHAT_ATTACHMENT_LIMITS,
  parseAssetUrl,
  type Asset,
} from "../../shared/ipc";
import {
  ChatAttachmentError,
  type AssetService,
} from "../assets/assetService";
import type {
  ChatImageDetail,
  ChatImageProcessor,
  PreparedChatImage,
} from "../assets/chatImageProcessor";

export const VIEW_CHAT_IMAGE_TOOL_NAME = "view_chat_image";

export const CHAT_MODEL_ATTACHMENT_LIMITS = Object.freeze({
  maxHistoryImagesPerResponse: 4,
  maxHistoryBytesPerResponse: 50 * 1024 * 1024,
  maxTotalBytesPerResponse: 100 * 1024 * 1024,
});

export type ChatAttachmentDatabase = {
  fetchAsset(id: string): Asset;
  fetchThreadChatAttachment(
    threadId: string,
    characterId: string,
    assetId: string,
  ): Asset;
};

export interface ViewChatImageResult {
  readonly status: "loaded";
  readonly attachmentId: string;
  readonly filename: string;
  readonly mediaType: string;
  readonly sourceByteSize: number;
  readonly detail: ChatImageDetail;
}

interface LoadedChatImage {
  readonly result: ViewChatImageResult;
  readonly modelImage: PreparedChatImage;
}

interface ActiveChatImageToolCall {
  readonly loaded: LoadedChatImage;
  readonly includeImage: boolean;
}

export class ChatAttachmentRunBudget {
  readonly #currentAssets = new Map<string, number>();
  readonly #historyAssets = new Map<string, number>();

  claimCurrent(assetId: string, byteSize: number): void {
    if (this.#currentAssets.has(assetId)) return;
    if (this.#currentAssets.size >= CHAT_ATTACHMENT_LIMITS.maxFilesPerMessage) {
      throw new ChatAttachmentError("当前消息最多向模型发送 10 个附件。");
    }
    const currentBytes = this.#sum(this.#currentAssets);
    if (
      currentBytes + byteSize >
      CHAT_ATTACHMENT_LIMITS.maxTotalBytesPerMessage
    ) {
      throw new ChatAttachmentError("当前消息发送给模型的附件不能超过 50 MiB。");
    }
    this.#assertTotal(byteSize);
    this.#currentAssets.set(assetId, byteSize);
  }

  claimHistory(assetId: string, byteSize: number): void {
    if (this.#historyAssets.has(assetId)) return;
    if (
      this.#historyAssets.size >=
      CHAT_MODEL_ATTACHMENT_LIMITS.maxHistoryImagesPerResponse
    ) {
      throw new ChatAttachmentError("每次回复最多读取 4 张历史图片。");
    }
    const historyBytes = this.#sum(this.#historyAssets);
    if (
      historyBytes + byteSize >
      CHAT_MODEL_ATTACHMENT_LIMITS.maxHistoryBytesPerResponse
    ) {
      throw new ChatAttachmentError("每次回复读取的历史图片不能超过 50 MiB。");
    }
    this.#assertTotal(byteSize);
    this.#historyAssets.set(assetId, byteSize);
  }

  #assertTotal(additionalBytes: number): void {
    const totalBytes =
      this.#sum(this.#currentAssets) + this.#sum(this.#historyAssets);
    if (
      totalBytes + additionalBytes >
      CHAT_MODEL_ATTACHMENT_LIMITS.maxTotalBytesPerResponse
    ) {
      throw new ChatAttachmentError("单次回复发送给模型的附件不能超过 100 MiB。");
    }
  }

  #sum(values: ReadonlyMap<string, number>): number {
    let total = 0;
    for (const value of values.values()) total += value;
    return total;
  }
}

export function createChatAttachmentDownload(
  database: Pick<ChatAttachmentDatabase, "fetchAsset">,
  assetService: Pick<AssetService, "readChatAttachment">,
  budget: ChatAttachmentRunBudget = new ChatAttachmentRunBudget(),
  allowedCurrentAssetIds?: ReadonlySet<string>,
): Experimental_DownloadFunction {
  const cache = new Map<string, PreparedChatImage>();
  return async (requests) =>
    Promise.all(
      requests.map(async ({ url, isUrlSupportedByModel }) => {
        const assetId = parseAssetUrl(url);
        if (assetId !== null) {
          if (
            allowedCurrentAssetIds !== undefined &&
            !allowedCurrentAssetIds.has(assetId)
          ) {
            throw new ChatAttachmentError(
              "历史附件不会自动发送给模型，请使用历史图片读取工具。",
            );
          }
          const cached = cache.get(assetId);
          if (cached !== undefined) return cached;
          const attachment = assetService.readChatAttachment(assetId, database);
          budget.claimCurrent(assetId, attachment.data.byteLength);
          const prepared = {
            data: attachment.data,
            mediaType: attachment.mediaType,
          };
          cache.set(assetId, prepared);
          return prepared;
        }
        if (isUrlSupportedByModel) return null;
        throw new ChatAttachmentError("附件引用无效或不受Katarune托管。");
      }),
    );
}

function historicalAttachmentMarker(asset: Asset): string {
  if (
    asset.status !== "ready" ||
    asset.kind !== "chat_attachment" ||
    asset.mimeType === null ||
    asset.byteSize === null ||
    asset.originalName === null
  ) {
    return "[历史附件不可用]";
  }
  const metadata = JSON.stringify({
    attachmentId: asset.id,
    filename: asset.originalName,
    mediaType: asset.mimeType,
    sourceByteSize: asset.byteSize,
  });
  return asset.mimeType.startsWith("image/")
    ? `[历史图片附件 ${metadata}] 如需查看图片内容，请调用 ${VIEW_CHAT_IMAGE_TOOL_NAME}，不要根据文件名猜测图片内容。`
    : `[历史文件附件 ${metadata}] 该文件的二进制内容未发送给模型；如需读取，请让用户重新附加。`;
}

export interface ProjectedChatMessages {
  readonly messages: UIMessage[];
  readonly currentAssetIds: ReadonlySet<string>;
}

export function projectChatAttachmentMessages(
  messages: readonly UIMessage[],
  database: Pick<ChatAttachmentDatabase, "fetchThreadChatAttachment">,
  threadId: string,
  characterId: string,
): ProjectedChatMessages {
  let currentUserIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") {
      currentUserIndex = index;
      break;
    }
  }

  const currentAssetIds = new Set<string>();
  const metadataCache = new Map<string, Asset | null>();
  const projected = messages.map((message, messageIndex) => {
    let changed = false;
    const parts = message.parts.map((part) => {
      if (part.type !== "file") return part;
      const assetId = parseAssetUrl(part.url);
      if (messageIndex === currentUserIndex) {
        if (assetId !== null) currentAssetIds.add(assetId);
        return part;
      }

      changed = true;
      if (assetId === null) {
        return {
          type: "text" as const,
          text: "[历史外部附件已省略] 如需读取，请让用户重新附加。",
        };
      }
      let asset = metadataCache.get(assetId);
      if (asset === undefined) {
        try {
          asset = database.fetchThreadChatAttachment(
            threadId,
            characterId,
            assetId,
          );
        } catch {
          asset = null;
        }
        metadataCache.set(assetId, asset);
      }
      return {
        type: "text" as const,
        text:
          asset === null
            ? "[历史附件不可用]"
            : historicalAttachmentMarker(asset),
      };
    });
    return changed ? { ...message, parts } : message;
  });

  if (currentAssetIds.size > CHAT_ATTACHMENT_LIMITS.maxFilesPerMessage) {
    throw new ChatAttachmentError("当前消息最多向模型发送 10 个附件。");
  }
  return { messages: projected, currentAssetIds };
}

export function createViewChatImageTools({
  database,
  assetService,
  imageProcessor,
  budget,
  threadId,
  characterId,
}: {
  readonly database: ChatAttachmentDatabase;
  readonly assetService: Pick<AssetService, "readChatAttachment">;
  readonly imageProcessor: ChatImageProcessor;
  readonly budget: ChatAttachmentRunBudget;
  readonly threadId: string;
  readonly characterId: string;
}): ToolSet {
  const loadedByAssetId = new Map<string, LoadedChatImage>();
  const activeToolCalls = new Map<string, ActiveChatImageToolCall>();

  return {
    [VIEW_CHAT_IMAGE_TOOL_NAME]: tool({
      description:
        "Read a historical image that the user previously attached in this chat. Call this only when a historical image reference is relevant and its visual contents are needed. Do not call it for an image already present in the current user message. If the call fails, do not retry the same attachment in this response.",
      inputSchema: z.object({
        attachmentId: z.uuid(),
        detail: z.enum(["high", "original"]).default("high"),
      }),
      execute: async ({ attachmentId, detail }, { toolCallId }) => {
        let loaded = loadedByAssetId.get(attachmentId);
        const includeImage = loaded === undefined;
        if (loaded === undefined) {
          let asset: Asset;
          try {
            asset = database.fetchThreadChatAttachment(
              threadId,
              characterId,
              attachmentId,
            );
          } catch {
            throw new ChatAttachmentError("该历史图片不属于当前会话或已不存在。");
          }
          if (
            asset.status !== "ready" ||
            asset.kind !== "chat_attachment" ||
            asset.mimeType === null ||
            asset.byteSize === null ||
            asset.originalName === null ||
            !asset.mimeType.startsWith("image/")
          ) {
            throw new ChatAttachmentError("该历史附件不是可用的图片。");
          }
          const attachment = assetService.readChatAttachment(
            attachmentId,
            database,
          );
          budget.claimHistory(attachmentId, attachment.data.byteLength);
          const modelImage = imageProcessor.prepare(
            attachment.data,
            attachment.mediaType,
            detail,
          );
          loaded = {
            result: {
              status: "loaded",
              attachmentId,
              filename: attachment.filename,
              mediaType: attachment.mediaType,
              sourceByteSize: attachment.data.byteLength,
              detail,
            },
            modelImage,
          };
          loadedByAssetId.set(attachmentId, loaded);
        }
        activeToolCalls.set(toolCallId, { loaded, includeImage });
        return loaded.result;
      },
      toModelOutput: ({ toolCallId, output }) => {
        const activeCall = activeToolCalls.get(toolCallId);
        if (activeCall === undefined) {
          return {
            type: "content",
            value: [
              {
                type: "text",
                text: `历史图片“${output.filename}”的字节未在后续请求中重放。如需再次查看，请使用 attachmentId ${output.attachmentId} 重新调用 ${VIEW_CHAT_IMAGE_TOOL_NAME}。`,
              },
            ],
          };
        }
        if (!activeCall.includeImage) {
          return {
            type: "content",
            value: [
              {
                type: "text",
                text: `历史图片“${activeCall.loaded.result.filename}”已在本次回复中读取，请使用此前的图片内容。`,
              },
            ],
          };
        }
        const loaded = activeCall.loaded;
        return {
          type: "content",
          value: [
            {
              type: "text",
              text: `已读取历史图片“${loaded.result.filename}”。`,
            },
            {
              type: "file",
              data: {
                type: "data",
                data: Buffer.from(loaded.modelImage.data).toString("base64"),
              },
              mediaType: loaded.modelImage.mediaType,
              filename: loaded.result.filename,
            },
          ],
        };
      },
    }),
  };
}
