import { nativeImage } from "electron";
import { ChatAttachmentError } from "./assetService";

export type ChatImageDetail = "high" | "original";

export interface PreparedChatImage {
  readonly data: Uint8Array;
  readonly mediaType: string;
}

export interface ChatImageProcessor {
  prepare(
    data: Uint8Array,
    mediaType: string,
    detail: ChatImageDetail,
  ): PreparedChatImage;
}

const MAX_HIGH_DETAIL_EDGE = 2048;

export function createElectronChatImageProcessor(): ChatImageProcessor {
  return {
    prepare: (data, mediaType, detail) => {
      if (!mediaType.toLowerCase().startsWith("image/")) {
        throw new ChatAttachmentError("该历史附件不是图片，暂时无法读取。");
      }

      let image: Electron.NativeImage;
      try {
        image = nativeImage.createFromBuffer(Buffer.from(data));
      } catch {
        throw new ChatAttachmentError("历史图片无法解码或格式不受支持。");
      }
      if (image.isEmpty()) {
        throw new ChatAttachmentError("历史图片无法解码或格式不受支持。");
      }

      if (detail === "original") {
        return { data, mediaType };
      }

      const { width, height } = image.getSize();
      const maximumEdge = Math.max(width, height);
      const prepared =
        maximumEdge <= MAX_HIGH_DETAIL_EDGE
          ? image
          : image.resize({
              ...(width >= height
                ? { width: MAX_HIGH_DETAIL_EDGE }
                : { height: MAX_HIGH_DETAIL_EDGE }),
              quality: "best",
            });
      const png = prepared.toPNG();
      if (png.byteLength === 0) {
        throw new ChatAttachmentError("历史图片处理失败，请尝试原图模式。");
      }
      return {
        data: new Uint8Array(png),
        mediaType: "image/png",
      };
    },
  };
}
