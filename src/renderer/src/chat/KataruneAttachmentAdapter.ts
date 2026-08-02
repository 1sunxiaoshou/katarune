import type {
  AttachmentAdapter,
  PendingAttachment,
} from "@assistant-ui/react";
import {
  assetUrl,
  CHAT_ATTACHMENT_LIMITS,
  DEFAULT_ATTACHMENT_MEDIA_TYPE,
} from "../../../shared/ipc";
import { notify } from "../notifications/notificationCenter";

function visibleAttachmentError(message: string): Error {
  notify({
    level: "error",
    message,
    dedupeKey: `chat-attachment:${message}`,
  });
  return new Error(message);
}

function attachmentName(file: File): string {
  const name = file.name.trim();
  return name.length > 0 ? name : "未命名附件";
}

export class KataruneAttachmentAdapter implements AttachmentAdapter {
  public readonly accept = "*";

  private readonly reservedBytes = new Map<string, number>();
  private pendingCount = 0;
  private pendingBytes = 0;

  public async add({ file }: { file: File }): Promise<PendingAttachment> {
    if (file.size > CHAT_ATTACHMENT_LIMITS.maxFileBytes) {
      throw visibleAttachmentError("单个附件不能超过 25 MiB。");
    }
    if (
      this.pendingCount + this.reservedBytes.size >=
      CHAT_ATTACHMENT_LIMITS.maxFilesPerMessage
    ) {
      throw visibleAttachmentError("单条消息最多添加 10 个附件。");
    }
    const currentBytes = [...this.reservedBytes.values()].reduce(
      (total, size) => total + size,
      this.pendingBytes,
    );
    if (
      currentBytes + file.size >
      CHAT_ATTACHMENT_LIMITS.maxTotalBytesPerMessage
    ) {
      throw visibleAttachmentError("单条消息的附件合计不能超过 50 MiB。");
    }

    this.pendingCount += 1;
    this.pendingBytes += file.size;
    try {
      const mediaType = file.type || DEFAULT_ATTACHMENT_MEDIA_TYPE;
      const asset = await window.katarune.importChatAttachment({
        name: attachmentName(file),
        mediaType,
        data: new Uint8Array(await file.arrayBuffer()),
      });
      if (asset.status !== "ready" || asset.kind !== "chat_attachment") {
        throw visibleAttachmentError("附件托管结果无效。");
      }
      this.reservedBytes.set(asset.id, file.size);
      return {
        id: asset.id,
        type: mediaType.startsWith("image/") ? "image" : "file",
        name: asset.originalName,
        file,
        contentType: asset.mimeType,
        content: mediaType.startsWith("image/")
          ? [{ type: "image", image: assetUrl(asset.id) }]
          : [],
        status: { type: "requires-action", reason: "composer-send" },
      };
    } catch (error) {
      if (!(error instanceof Error && error.message === "附件托管结果无效。")) {
        notify({
          level: "error",
          message:
            error instanceof Error && error.message.length > 0
              ? error.message
              : "附件导入失败，请重试。",
          dedupeKey: "chat-attachment:import-failed",
        });
      }
      throw error;
    } finally {
      this.pendingCount -= 1;
      this.pendingBytes -= file.size;
    }
  }

  public async remove(attachment: PendingAttachment): Promise<void> {
    this.reservedBytes.delete(attachment.id);
    await window.katarune.releaseChatAttachment({ assetId: attachment.id });
  }

  public async send(attachment: PendingAttachment) {
    this.reservedBytes.delete(attachment.id);
    return {
      ...attachment,
      status: { type: "complete" as const },
      content: [
        {
          type: "file" as const,
          mimeType: attachment.contentType || DEFAULT_ATTACHMENT_MEDIA_TYPE,
          filename: attachment.name,
          data: assetUrl(attachment.id),
        },
      ],
    };
  }
}
