import { afterEach, describe, expect, it, vi } from "vitest";
import { KataruneAttachmentAdapter } from "../src/renderer/src/chat/KataruneAttachmentAdapter";
import type { Asset, KataruneApi } from "../src/shared/ipc";

const assetId = "11111111-1111-4111-8111-111111111111";

afterEach(() => {
  vi.unstubAllGlobals();
});

function readyAttachment(overrides: Partial<Asset> = {}): Asset {
  return {
    id: assetId,
    kind: "chat_attachment",
    status: "ready",
    mimeType: "application/octet-stream",
    byteSize: 3,
    sha256: "a".repeat(64),
    originalName: "数据.dat",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Asset;
}

describe("KataruneAttachmentAdapter", () => {
  it("imports selected bytes through IPC and sends only a managed URL", async () => {
    const importChatAttachment = vi.fn(async () => readyAttachment());
    const releaseChatAttachment = vi.fn(async () => ({ success: true as const }));
    vi.stubGlobal("window", {
      katarune: {
        importChatAttachment,
        releaseChatAttachment,
      } as unknown as KataruneApi,
    });
    const adapter = new KataruneAttachmentAdapter();
    const file = new File([new Uint8Array([1, 2, 3])], "数据.dat");

    const pending = await adapter.add({ file });
    expect(importChatAttachment).toHaveBeenCalledWith({
      name: "数据.dat",
      mediaType: "application/octet-stream",
      data: new Uint8Array([1, 2, 3]),
    });

    const complete = await adapter.send(pending);
    expect(complete.content).toEqual([
      {
        type: "file",
        mimeType: "application/octet-stream",
        filename: "数据.dat",
        data: `katarune-asset://asset/${assetId}`,
      },
    ]);
    expect(JSON.stringify(complete)).not.toContain("data:");
  });

  it("releases a removed draft while main remains responsible for reference checks", async () => {
    const releaseChatAttachment = vi.fn(async () => ({ success: true as const }));
    vi.stubGlobal("window", {
      katarune: {
        importChatAttachment: vi.fn(async () =>
          readyAttachment({ mimeType: "image/png", originalName: "截图.png" }),
        ),
        releaseChatAttachment,
      } as unknown as KataruneApi,
    });
    const adapter = new KataruneAttachmentAdapter();
    const pending = await adapter.add({
      file: new File([new Uint8Array([1, 2, 3])], "截图.png", {
        type: "image/png",
      }),
    });

    expect(pending.type).toBe("image");
    expect(pending.content).toEqual([
      {
        type: "image",
        image: `katarune-asset://asset/${assetId}`,
      },
    ]);
    await adapter.remove(pending);
    expect(releaseChatAttachment).toHaveBeenCalledWith({ assetId });
  });

  it("enforces the per-file limit before invoking main", async () => {
    const importChatAttachment = vi.fn();
    vi.stubGlobal("window", {
      katarune: { importChatAttachment } as unknown as KataruneApi,
    });
    const adapter = new KataruneAttachmentAdapter();
    const oversized = new File(
      [new Uint8Array(25 * 1024 * 1024 + 1)],
      "oversized.bin",
    );

    await expect(adapter.add({ file: oversized })).rejects.toThrow("25 MiB");
    expect(importChatAttachment).not.toHaveBeenCalled();
  });
});
