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
});
