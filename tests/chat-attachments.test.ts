import { describe, expect, it, vi } from "vitest";
import type { ToolSet, UIMessage } from "ai";
import type { Asset } from "../src/shared/ipc";
import {
  ChatAttachmentRunBudget,
  createChatAttachmentDownload,
  createViewChatImageTools,
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
  const imageTool = tools.view_chat_image;
  if (imageTool?.execute === undefined || imageTool.toModelOutput === undefined) {
    throw new Error("view_chat_image is not executable");
  }
  return imageTool as NonNullable<ToolSet[string]> &
    Required<
      Pick<NonNullable<ToolSet[string]>, "execute" | "toModelOutput">
    >;
}

describe("chat attachment model projection", () => {
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
    );

    expect(projected.currentAssetIds).toEqual(new Set([currentImageId]));
    expect(projected.messages[0]?.parts[1]).toMatchObject({
      type: "text",
      text: expect.stringContaining(`"attachmentId":"${imageId}"`),
    });
    expect(JSON.stringify(projected.messages[0])).toContain("view_chat_image");
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
      { fetchAsset: () => readyImage(imageId) },
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

describe("view_chat_image", () => {
  function createTools(
    assets: ReadonlyMap<string, Asset>,
    readChatAttachment = vi.fn((assetId: string) => ({
      data: new Uint8Array([1, 2, 3]),
      mediaType: "image/png",
      filename: assets.get(assetId)?.originalName ?? "图片.png",
    })),
  ) {
    const fetchThreadChatAttachment = vi.fn(
      (_threadId: string, _characterId: string, assetId: string) => {
        const asset = assets.get(assetId);
        if (asset === undefined) throw new Error("not found");
        return asset;
      },
    );
    const prepare = vi.fn((data: Uint8Array) => ({
      data: new Uint8Array([...data, 4]),
      mediaType: "image/png",
    }));
    const tools = createViewChatImageTools({
      database: {
        fetchAsset: (id) => {
          const asset = assets.get(id);
          if (asset === undefined) throw new Error("not found");
          return asset;
        },
        fetchThreadChatAttachment,
      },
      assetService: { readChatAttachment },
      imageProcessor: { prepare },
      budget: new ChatAttachmentRunBudget(),
      threadId: "thread-1",
      characterId,
    });
    return { tools, fetchThreadChatAttachment, readChatAttachment, prepare };
  }

  it("returns image content only for tool calls executed in the current response", async () => {
    const assets = new Map([[imageId, readyImage(imageId)]]);
    const current = createTools(assets);
    const imageTool = executableTool(current.tools);
    const output = await imageTool.execute(
      { attachmentId: imageId, detail: "high" },
      {
        toolCallId: "call-current",
        messages: [],
        context: undefined,
      },
    );
    if (Symbol.asyncIterator in Object(output)) {
      throw new Error("unexpected streaming tool output");
    }
    const modelOutput = await imageTool.toModelOutput({
      toolCallId: "call-current",
      input: { attachmentId: imageId, detail: "high" },
      output,
    });

    expect(output).toEqual({
      status: "loaded",
      attachmentId: imageId,
      filename: "历史图片.png",
      mediaType: "image/png",
      sourceByteSize: 3,
      detail: "high",
    });
    expect(JSON.stringify(output)).not.toContain("AQIDBA");
    expect(JSON.stringify(modelOutput)).toContain("AQIDBA==");

    const replay = executableTool(createTools(assets).tools);
    const replayOutput = await replay.toModelOutput({
      toolCallId: "call-current",
      input: { attachmentId: imageId, detail: "high" },
      output,
    });
    expect(JSON.stringify(replayOutput)).toContain("未在后续请求中重放");
    expect(JSON.stringify(replayOutput)).not.toContain("AQIDBA==");
  });

  it("scopes access to the current thread and caches duplicate reads", async () => {
    const assets = new Map([[imageId, readyImage(imageId)]]);
    const context = createTools(assets);
    const imageTool = executableTool(context.tools);
    const outputs: unknown[] = [];
    for (const toolCallId of ["call-one", "call-two"]) {
      const output = await imageTool.execute(
        { attachmentId: imageId, detail: "high" },
        { toolCallId, messages: [], context: undefined },
      );
      if (Symbol.asyncIterator in Object(output)) {
        throw new Error("unexpected streaming tool output");
      }
      outputs.push(
        await imageTool.toModelOutput({
          toolCallId,
          input: { attachmentId: imageId, detail: "high" },
          output,
        }),
      );
    }
    expect(context.fetchThreadChatAttachment).toHaveBeenCalledTimes(1);
    expect(context.readChatAttachment).toHaveBeenCalledTimes(1);
    expect(context.prepare).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(outputs[0])).toContain("AQIDBA==");
    expect(JSON.stringify(outputs[1])).toContain("已在本次回复中读取");
    expect(JSON.stringify(outputs[1])).not.toContain("AQIDBA==");

    const missingId = "99999999-9999-4999-8999-999999999999";
    await expect(
      imageTool.execute(
        { attachmentId: missingId, detail: "high" },
        { toolCallId: "call-missing", messages: [], context: undefined },
      ),
    ).rejects.toThrow("不属于当前会话");
  });

  it("enforces the four-image history budget", async () => {
    const assets = new Map<string, Asset>();
    for (let index = 1; index <= 5; index += 1) {
      const id = `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
      assets.set(id, readyImage(id, `图片${index}.png`));
    }
    const imageTool = executableTool(createTools(assets).tools);
    let index = 0;
    for (const id of assets.keys()) {
      index += 1;
      const execution = imageTool.execute(
        { attachmentId: id, detail: "high" },
        { toolCallId: `call-${index}`, messages: [], context: undefined },
      );
      if (index <= 4) {
        await expect(execution).resolves.toMatchObject({ attachmentId: id });
      } else {
        await expect(execution).rejects.toThrow("最多读取 4 张");
      }
    }
  });

  it("charges history limits against source bytes before image processing", async () => {
    const budget = new ChatAttachmentRunBudget();
    const firstId = "10000000-0000-4000-8000-000000000001";
    const secondId = "10000000-0000-4000-8000-000000000002";
    budget.claimHistory(firstId, 30 * 1024 * 1024);

    expect(() =>
      budget.claimHistory(secondId, 21 * 1024 * 1024),
    ).toThrow("不能超过 50 MiB");
  });
});
