import { describe, expect, it, vi } from "vitest";
import type { ToolSet, UIMessage } from "ai";
import type { Asset } from "../src/shared/ipc";
import {
  ChatAttachmentRunBudget,
  chatAttachmentPath,
  createChatAttachmentDownload,
  createViewImageTools,
  projectChatAttachmentMessages,
} from "../src/main/ai/chatAttachments";

const characterId = "00000000-0000-4000-8000-000000000001";
const imageId = "11111111-1111-4111-8111-111111111111";
const currentImageId = "22222222-2222-4222-8222-222222222222";

function readyImage(id: string, filename = "历史图片.png"): Asset {
  const now = new Date("2026-08-03T00:00:00.000Z");
  return {
    id,
    kind: "chat_attachment",
    status: "ready",
    mimeType: "image/png",
    byteSize: 3,
    sha256: "a".repeat(64),
    originalName: filename,
    createdAt: now,
    updatedAt: now,
  };
}

function executableTool(tools: ToolSet) {
  const imageTool = tools.view_image;
  if (imageTool?.execute === undefined || imageTool.toModelOutput === undefined) {
    throw new Error("view_image is not executable");
  }
  return imageTool as NonNullable<ToolSet[string]> &
    Required<
      Pick<NonNullable<ToolSet[string]>, "execute" | "toModelOutput">
    >;
}

describe("chat attachment model projection", () => {
  it("routes current text/data files through the workspace while retaining native image input", () => {
    const messages: UIMessage[] = [{ id: "current", role: "user", parts: [
      { type: "file", filename: "data.csv", mediaType: "text/csv", url: `katarune-asset://asset/${imageId}` },
      { type: "file", filename: "image.png", mediaType: "image/png", url: `katarune-asset://asset/${currentImageId}` },
    ] }];
    const projected = projectChatAttachmentMessages(messages, { fetchThreadChatAttachment: () => readyImage(imageId) }, "thread-1", characterId, new Map([[imageId, chatAttachmentPath(readyImage(imageId))]]));
    expect(projected.messages[0]?.parts.map(part => part.type)).toEqual(["text", "file"]);
    expect(projected.messages[0]?.parts[1]).toEqual(messages[0]?.parts[1]);
    expect(projected.currentAssetIds).toEqual(new Set([imageId, currentImageId]));
    expect(messages[0]?.parts[0]?.type).toBe("file");
  });
  it("keeps only the latest user attachments and replaces history with stable references", () => {
    const historical: UIMessage = {
      id: "historical-user",
      role: "user",
      parts: [
        { type: "text", text: "看看这张图" },
        {
          type: "file",
          mediaType: "image/png",
          filename: "历史图片.png",
          url: `katarune-asset://asset/${imageId}`,
        },
      ],
    };
    const current: UIMessage = {
      id: "current-user",
      role: "user",
      parts: [
        { type: "text", text: "对比现在这张" },
        {
          type: "file",
          mediaType: "image/png",
          filename: "当前图片.png",
          url: `katarune-asset://asset/${currentImageId}`,
        },
      ],
    };
    const fetchThreadChatAttachment = vi.fn(() => readyImage(imageId));

    const projected = projectChatAttachmentMessages(
      [historical, current],
      { fetchThreadChatAttachment },
      "thread-1",
      characterId,
      new Map([[imageId, chatAttachmentPath(readyImage(imageId))]]),
    );

    expect(projected.currentAssetIds).toEqual(new Set([currentImageId]));
    expect(projected.messages[0]?.parts[1]).toMatchObject({
      type: "text",
      text: expect.stringContaining(`"path":"${chatAttachmentPath(readyImage(imageId))}"`),
    });
    expect(JSON.stringify(projected.messages[0])).toContain("view_image");
    expect(projected.messages[1]?.parts[1]).toEqual(current.parts[1]);
    expect(historical.parts[1]).toMatchObject({ type: "file" });
    expect(fetchThreadChatAttachment).toHaveBeenCalledWith(
      "thread-1",
      characterId,
      imageId,
    );
  });

  it("does not allow the current-message downloader to rematerialize history", async () => {
    const readChatAttachment = vi.fn(() => ({
      data: new Uint8Array([1, 2, 3]),
      mediaType: "image/png",
      filename: "历史图片.png",
    }));
    const download = createChatAttachmentDownload(
      { fetchAssetSourcePath: () => null, fetchAsset: () => readyImage(imageId) },
      { readChatAttachment },
      new ChatAttachmentRunBudget(),
      new Set([currentImageId]),
    );

    await expect(
      download([
        {
          url: new URL(`katarune-asset://asset/${imageId}`),
          isUrlSupportedByModel: false,
        },
      ]),
    ).rejects.toThrow("历史附件不会自动发送");
    expect(readChatAttachment).not.toHaveBeenCalled();
  });
});

describe("view_image", () => {
  function setup(readImage = vi.fn(async (_path: string) => ({ data: new Uint8Array([1, 2, 3]), mediaType: "image/png", filename: "image.png" }))) {
    return { readImage, imageTool: executableTool(createViewImageTools({ readImage,
      imageProcessor: { prepare: (data, mediaType) => ({ data, mediaType }) }, budget: new ChatAttachmentRunBudget(),
    })) };
  }

  it("returns native image content without persisting bytes in tool results or replaying history", async () => {
    const { imageTool } = setup();
    const input = { path: "/attachments/image.png" };
    const output = await imageTool.execute(input, { toolCallId: "view", messages: [], context: undefined });
    expect(output).toEqual({ status: "loaded", filename: "image.png", mediaType: "image/png", sourceByteSize: 3 });
    expect(JSON.stringify(await imageTool.toModelOutput({ toolCallId: "view", input, output }))).toContain("AQID");
    const replay = setup().imageTool;
    expect(JSON.stringify(await replay.toModelOutput({ toolCallId: "view", input, output }))).not.toContain("AQID");
  });

  it("accepts only path and propagates permission failures", async () => {
    const { imageTool, readImage } = setup();
    for (const input of [{}, { attachmentId: imageId }, { path: "image.png", detail: "original" }, { path: "" }, { path: "bad\0path" }]) {
      await expect(imageTool.execute(input, { toolCallId: "invalid", messages: [], context: undefined })).rejects.toThrow();
    }
    expect(readImage).not.toHaveBeenCalled();
    readImage.mockRejectedValue(new Error("not authorized"));
    await expect(imageTool.execute({ path: "/outside/image.png" }, { toolCallId: "denied", messages: [], context: undefined })).rejects.toThrow("not authorized");
  });

  it("rereads edited images and does not serve cached bytes after deletion", async () => {
    const { imageTool, readImage } = setup();
    const input = { path: "image.png" };
    await imageTool.execute(input, { toolCallId: "first", messages: [], context: undefined });
    readImage.mockResolvedValue({ data: new Uint8Array([4, 5, 6]), mediaType: "image/png", filename: "image.png" });
    const output = await imageTool.execute(input, { toolCallId: "second", messages: [], context: undefined });
    expect(JSON.stringify(await imageTool.toModelOutput({ toolCallId: "second", input, output }))).toContain("BAUG");
    readImage.mockRejectedValue(new Error("file missing"));
    await expect(imageTool.execute(input, { toolCallId: "third", messages: [], context: undefined })).rejects.toThrow("file missing");
  });

  it("bounds repeated image reads and rejects non-images", async () => {
    const { imageTool } = setup();
    for (let i = 0; i < 4; i++) await imageTool.execute({ path: "image.png" }, { toolCallId: `view-${i}`, messages: [], context: undefined });
    await expect(imageTool.execute({ path: "image.png" }, { toolCallId: "overflow", messages: [], context: undefined })).rejects.toThrow("最多读取 4 张");
    const other = setup();
    other.readImage.mockResolvedValue({ data: new Uint8Array([1]), mediaType: "text/plain", filename: "file.txt" });
    await expect(other.imageTool.execute({ path: "file.txt" }, { toolCallId: "text", messages: [], context: undefined })).rejects.toThrow("不是图片");
    const budget = new ChatAttachmentRunBudget();
    budget.claimHistory("first", 30 * 1024 * 1024);
    expect(() => budget.claimHistory("second", 21 * 1024 * 1024)).toThrow("不能超过 50 MiB");
  });
});
