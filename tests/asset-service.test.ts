import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Asset } from "../src/shared/assets";
import { createAssetService } from "../src/main/assets/assetService";
import { handleAssetRequest } from "../src/main/assets/assetProtocol";
import type { DatabaseRuntime } from "../src/main/database/database";

const assetId = "00000000-0000-4000-8000-000000000002";
const createdPaths: string[] = [];

afterEach(() => {
  for (const path of createdPaths.splice(0)) {
    rmSync(path, { force: true, recursive: true });
  }
});

function tempDirectory(): string {
  const path = mkdtempSync(join(tmpdir(), "katarune-assets-test-"));
  createdPaths.push(path);
  return path;
}

function readyAsset(byteSize: number): Asset {
  const now = new Date("2026-07-24T00:00:00.000Z");
  return {
    id: assetId,
    kind: "character_portrait",
    status: "ready",
    mimeType: "image/png",
    byteSize,
    sha256: "a".repeat(64),
    originalName: "portrait.png",
    createdAt: now,
    updatedAt: now,
  };
}

describe("generic asset service and protocol", () => {
  it("stages and commits a signed portrait into an extensionless immutable asset", () => {
    const userDataPath = tempDirectory();
    const resourcesPath = join(process.cwd(), "resources", "characters");
    const service = createAssetService({
      userDataPath,
      characterResourcesPath: resourcesPath,
    });
    const staged = service.stagePortrait(
      join(resourcesPath, "sunohara-kokona.png"),
    );
    const registration = service.commitStagedPortrait(staged.id, (asset) => asset);

    expect(registration.mimeType).toBe("image/png");
    expect(registration.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(readFileSync(service.resolveManagedPath(registration.id)).byteLength).toBe(
      registration.byteSize,
    );
    expect(service.resolveManagedPath(registration.id)).toBe(
      join(userDataPath, "assets", registration.id),
    );
  });

  it("rejects a portrait whose extension does not match its signature", () => {
    const userDataPath = tempDirectory();
    const invalidPath = join(userDataPath, "invalid.png");
    writeFileSync(invalidPath, "not a png");
    const service = createAssetService({
      userDataPath,
      characterResourcesPath: join(process.cwd(), "resources", "characters"),
    });
    expect(() => service.stagePortrait(invalidPath)).toThrow(/文件内容不一致/);
  });

  it("moves an exact legacy portrait and keeps absent assets missing", () => {
    const userDataPath = tempDirectory();
    const resourcesPath = join(process.cwd(), "resources", "characters");
    const legacyDirectory = join(userDataPath, "character-assets");
    mkdirSync(legacyDirectory);
    copyFileSync(
      join(resourcesPath, "sunohara-kokona.png"),
      join(legacyDirectory, `${assetId}.png`),
    );
    const missingId = "00000000-0000-4000-8000-000000000004";
    const now = new Date("2026-07-24T00:00:00.000Z");
    const missing = (id: string): Asset => ({
      id,
      kind: "character_portrait",
      status: "missing",
      mimeType: null,
      byteSize: null,
      sha256: null,
      originalName: null,
      createdAt: now,
      updatedAt: now,
    });
    const marked = new Map<string, { mimeType: string; byteSize: number }>();
    const database = {
      listAssets: () => [missing(assetId), missing(missingId)],
      markAssetReady: (
        id: string,
        metadata: { mimeType: string; byteSize: number },
      ) => {
        marked.set(id, metadata);
        return readyAsset(metadata.byteSize);
      },
    } as unknown as DatabaseRuntime;
    const service = createAssetService({
      userDataPath,
      characterResourcesPath: resourcesPath,
    });

    service.reconcile(database, {
      version: 1,
      character: {
        id: "00000000-0000-4000-8000-000000000001",
        name: "星澜",
        modelConfigId: null,
        systemPrompt: "",
        portrait: null,
      },
    });

    expect(marked.get(assetId)?.mimeType).toBe("image/png");
    expect(marked.has(missingId)).toBe(false);
    expect(existsSync(join(legacyDirectory, `${assetId}.png`))).toBe(false);
    expect(existsSync(service.resolveManagedPath(assetId))).toBe(true);
  });

  it("serves GET and HEAD and rejects invalid, missing, and unsafe requests", async () => {
    const userDataPath = tempDirectory();
    const service = createAssetService({
      userDataPath,
      characterResourcesPath: join(process.cwd(), "resources", "characters"),
    });
    const staged = service.stagePortrait(
      join(process.cwd(), "resources", "characters", "sunohara-kokona.png"),
    );
    const imported = service.commitStagedPortrait(staged.id, (asset) => asset);
    const asset = { ...readyAsset(imported.byteSize), id: imported.id };
    const database = {
      fetchAsset: (id: string) => {
        if (id !== imported.id) throw new Error("not found");
        return asset;
      },
    } as unknown as DatabaseRuntime;
    const url = `katarune-asset://asset/${imported.id}`;

    const get = handleAssetRequest(new Request(url), database, service);
    expect(get.status).toBe(200);
    expect(get.headers.get("content-type")).toBe("image/png");
    expect(get.headers.get("cache-control")).toContain("immutable");
    expect((await get.arrayBuffer()).byteLength).toBe(imported.byteSize);

    const head = handleAssetRequest(new Request(url, { method: "HEAD" }), database, service);
    expect(head.status).toBe(200);
    expect((await head.arrayBuffer()).byteLength).toBe(0);
    expect(
      handleAssetRequest(new Request(url, { method: "POST" }), database, service).status,
    ).toBe(405);
    expect(
      handleAssetRequest(
        new Request("katarune-asset://asset/not-a-uuid"),
        database,
        service,
      ).status,
    ).toBe(400);
    expect(
      handleAssetRequest(
        new Request(`katarune-asset://asset/${assetId}`),
        database,
        service,
      ).status,
    ).toBe(404);

    const missingDatabase = {
      fetchAsset: () => ({
        id: imported.id,
        status: "missing",
        mimeType: null,
        byteSize: null,
        sha256: null,
        originalName: null,
        createdAt: asset.createdAt,
        updatedAt: asset.updatedAt,
      }),
    } as unknown as DatabaseRuntime;
    expect(handleAssetRequest(new Request(url), missingDatabase, service).status).toBe(404);

    const unsafeService = {
      ...service,
      resolveManagedPath: () => {
        throw new Error("escape");
      },
    };
    expect(handleAssetRequest(new Request(url), database, unsafeService).status).toBe(400);
    expect(readFileSync(join(process.cwd(), "src", "renderer", "index.html"), "utf8"))
      .toContain("img-src 'self' data: katarune-asset:");
  });

  it("serves only registered staged portraits without caching and discards them", async () => {
    const userDataPath = tempDirectory();
    const service = createAssetService({
      userDataPath,
      characterResourcesPath: join(process.cwd(), "resources", "characters"),
    });
    const staged = service.stagePortrait(
      join(process.cwd(), "resources", "characters", "sunohara-kokona.png"),
    );
    const database = {
      fetchAsset: () => {
        throw new Error("staged requests must not query persisted assets");
      },
    } as unknown as DatabaseRuntime;
    const url = `katarune-asset://staged/${staged.id}`;

    const response = handleAssetRequest(new Request(url), database, service);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-type")).toBe("image/png");
    expect((await response.arrayBuffer()).byteLength).toBe(staged.byteSize);
    expect(
      handleAssetRequest(
        new Request(`katarune-asset://staged/${assetId}`),
        database,
        service,
      ).status,
    ).toBe(404);

    service.discardStagedPortrait(staged.id);
    expect(handleAssetRequest(new Request(url), database, service).status).toBe(404);
  });

  it("restores a staged portrait after a failed commit and removes stale stages on startup", () => {
    const userDataPath = tempDirectory();
    const resourcesPath = join(process.cwd(), "resources", "characters");
    const stagingDirectory = join(userDataPath, "asset-staging");
    mkdirSync(stagingDirectory, { recursive: true });
    const staleId = "00000000-0000-4000-8000-000000000009";
    const stalePath = join(stagingDirectory, `${staleId}.tmp`);
    writeFileSync(stalePath, "stale");

    const service = createAssetService({
      userDataPath,
      characterResourcesPath: resourcesPath,
    });
    expect(existsSync(stalePath)).toBe(false);

    const staged = service.stagePortrait(join(resourcesPath, "sunohara-kokona.png"));
    expect(() =>
      service.commitStagedPortrait(staged.id, () => {
        throw new Error("database failed");
      }),
    ).toThrow("database failed");
    expect(service.resolveStagedPortrait(staged.id).byteSize).toBe(staged.byteSize);
    expect(existsSync(service.resolveManagedPath(staged.id))).toBe(false);

    const committed = service.commitStagedPortrait(staged.id, (asset) => asset);
    expect(committed.id).toBe(staged.id);
    expect(existsSync(service.resolveManagedPath(staged.id))).toBe(true);
    expect(() => service.resolveStagedPortrait(staged.id)).toThrow(/不存在或已失效/);
  });

  it("copies arbitrary chat attachment bytes, normalizes MIME, verifies integrity, and releases drafts", () => {
    const userDataPath = tempDirectory();
    const service = createAssetService({
      userDataPath,
      characterResourcesPath: join(process.cwd(), "resources", "characters"),
    });
    const assets = new Map<string, Asset>();
    const referenced = new Set<string>();
    const now = new Date("2026-08-02T00:00:00.000Z");
    const database = {
      registerReadyAsset: (registration: {
        id: string;
        kind: "chat_attachment";
        mimeType: string;
        byteSize: number;
        sha256: string;
        originalName: string;
      }) => {
        const asset: Asset = {
          ...registration,
          status: "ready",
          createdAt: now,
          updatedAt: now,
        };
        assets.set(asset.id, asset);
        return asset;
      },
      fetchAsset: (id: string) => {
        const asset = assets.get(id);
        if (asset === undefined) throw new Error("not found");
        return asset;
      },
      deleteUnreferencedChatAttachment: (id: string) => {
        if (referenced.has(id)) return false;
        return assets.delete(id);
      },
      listUnreferencedChatAttachmentIds: () =>
        [...assets.keys()].filter((id) => !referenced.has(id)),
    } as unknown as DatabaseRuntime;

    const imported = service.importChatAttachment(
      {
        name: "测试数据.bin",
        mediaType: "",
        data: new Uint8Array([0, 1, 2, 3]),
      },
      database,
    );

    expect(imported).toMatchObject({
      kind: "chat_attachment",
      status: "ready",
      mimeType: "application/octet-stream",
      originalName: "测试数据.bin",
      byteSize: 4,
    });
    expect(service.resolveManagedPath(imported.id)).toBe(
      join(userDataPath, "assets", imported.id),
    );
    expect(service.readChatAttachment(imported.id, database)).toMatchObject({
      mediaType: "application/octet-stream",
      filename: "测试数据.bin",
    });

    referenced.add(imported.id);
    expect(service.releaseChatAttachment(imported.id, database)).toBe(false);
    expect(existsSync(service.resolveManagedPath(imported.id))).toBe(true);
    referenced.delete(imported.id);
    expect(service.releaseChatAttachment(imported.id, database)).toBe(true);
    expect(existsSync(service.resolveManagedPath(imported.id))).toBe(false);
    expect(assets.has(imported.id)).toBe(false);

    const zeroByte = service.importChatAttachment(
      {
        name: "empty.unknown",
        mediaType: "application/x-unknown",
        data: new Uint8Array(),
      },
      database,
    );
    expect(zeroByte.byteSize).toBe(0);
    expect(service.readChatAttachment(zeroByte.id, database).data).toHaveLength(0);
    service.cleanupUnreferencedChatAttachments(database);
    expect(assets.has(zeroByte.id)).toBe(false);
    expect(existsSync(service.resolveManagedPath(zeroByte.id))).toBe(false);
  });

  it("rejects tampered chat attachment bytes and does not serve non-images", () => {
    const userDataPath = tempDirectory();
    const service = createAssetService({
      userDataPath,
      characterResourcesPath: join(process.cwd(), "resources", "characters"),
    });
    let imported: Asset | undefined;
    const database = {
      registerReadyAsset: (registration: Record<string, unknown>) => {
        imported = {
          ...registration,
          status: "ready",
          createdAt: new Date(),
          updatedAt: new Date(),
        } as Asset;
        return imported;
      },
      fetchAsset: () => imported,
    } as unknown as DatabaseRuntime;
    const asset = service.importChatAttachment(
      {
        name: "notes.txt",
        mediaType: "text/plain",
        data: new TextEncoder().encode("safe"),
      },
      database,
    );
    expect(
      handleAssetRequest(
        new Request(`katarune-asset://asset/${asset.id}`),
        database,
        service,
      ).status,
    ).toBe(415);
    writeFileSync(service.resolveManagedPath(asset.id), "tampered");
    expect(() => service.readChatAttachment(asset.id, database)).toThrow(
      /完整性校验失败/,
    );
  });
});
