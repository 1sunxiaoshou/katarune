import { createHash, randomUUID } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, extname, join, resolve, sep } from "node:path";
import {
  stagedCharacterPortraitSchema,
  type DefaultCharacterConfig,
  type StagedCharacterPortrait,
} from "../../shared/characters";
import type {
  Asset,
  ImportChatAttachmentRequest,
} from "../../shared/ipc";
import {
  CHAT_ATTACHMENT_LIMITS,
  DEFAULT_ATTACHMENT_MEDIA_TYPE,
} from "../../shared/ipc";
import type {
  AssetMetadata,
  DatabaseRuntime,
  ReadyAssetRegistration,
} from "../database/database";

const MAX_PORTRAIT_BYTES = 10 * 1024 * 1024;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PORTRAIT_MIME_BY_EXTENSION = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
} as const;

type PortraitMime = (typeof PORTRAIT_MIME_BY_EXTENSION)[keyof typeof PORTRAIT_MIME_BY_EXTENSION];

export interface AssetService {
  stagePortrait(sourcePath: string): StagedCharacterPortrait;
  commitStagedPortrait<T>(
    stageId: string,
    commit: (asset: ReadyAssetRegistration) => T,
  ): T;
  discardStagedPortrait(stageId: string): void;
  removeExact(assetId: string): void;
  resolveManagedPath(assetId: string): string;
  resolveStagedPortrait(stageId: string): {
    readonly path: string;
    readonly mimeType: string;
    readonly byteSize: number;
  };
  reconcile(database: DatabaseRuntime, config: DefaultCharacterConfig): void;
  importChatAttachment(
    request: ImportChatAttachmentRequest,
    database: DatabaseRuntime,
  ): Asset;
  readChatAttachment(
    assetId: string,
    database: Pick<DatabaseRuntime, "fetchAsset">,
  ): ChatAttachmentBytes;
  releaseChatAttachment(assetId: string, database: DatabaseRuntime): boolean;
  cleanupUnreferencedChatAttachments(database: DatabaseRuntime): void;
}

export interface ChatAttachmentBytes {
  readonly data: Uint8Array;
  readonly mediaType: string;
  readonly filename: string;
}

export class ChatAttachmentError extends Error {}

interface CreateAssetServiceOptions {
  readonly userDataPath: string;
  readonly characterResourcesPath: string;
}

function expectedMime(filePath: string): PortraitMime {
  const extension = extname(filePath).toLocaleLowerCase();
  const mime = PORTRAIT_MIME_BY_EXTENSION[
    extension as keyof typeof PORTRAIT_MIME_BY_EXTENSION
  ];
  if (mime === undefined) {
    throw new Error("仅支持 PNG、JPEG 和 WebP 立绘。");
  }
  return mime;
}

function detectedMime(content: Buffer): PortraitMime | null {
  if (
    content.length >= 8 &&
    content.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return "image/png";
  }
  if (content.length >= 3 && content[0] === 0xff && content[1] === 0xd8 && content[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    content.length >= 12 &&
    content.subarray(0, 4).toString("ascii") === "RIFF" &&
    content.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

function inspectPortrait(filePath: string, originalName: string): AssetMetadata {
  const mimeType = expectedMime(originalName);
  const byteSize = statSync(filePath).size;
  if (byteSize > MAX_PORTRAIT_BYTES) {
    throw new Error("立绘文件不能超过 10 MiB。");
  }
  const content = readFileSync(filePath);
  if (detectedMime(content) !== mimeType) {
    throw new Error("立绘扩展名与文件内容不一致。");
  }
  return {
    mimeType,
    byteSize,
    sha256: createHash("sha256").update(content).digest("hex"),
    originalName,
  };
}

function inspectStoredPortrait(filePath: string, assetId: string): AssetMetadata {
  const content = readFileSync(filePath);
  const mimeType = detectedMime(content);
  if (mimeType === null) {
    throw new Error("托管资产不是受支持的立绘文件。");
  }
  if (content.byteLength > MAX_PORTRAIT_BYTES) {
    throw new Error("立绘文件不能超过 10 MiB。");
  }
  const extension =
    mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : "jpg";
  return {
    mimeType,
    byteSize: content.byteLength,
    sha256: createHash("sha256").update(content).digest("hex"),
    originalName: `recovered-${assetId}.${extension}`,
  };
}

export function createAssetService({
  userDataPath,
  characterResourcesPath,
}: CreateAssetServiceOptions): AssetService {
  const assetDirectory = resolve(userDataPath, "assets");
  const stagingDirectory = resolve(userDataPath, "asset-staging");
  const legacyDirectory = resolve(userDataPath, "character-assets");
  mkdirSync(assetDirectory, { recursive: true });
  mkdirSync(stagingDirectory, { recursive: true });
  for (const entry of readdirSync(stagingDirectory)) {
    if (!/^[0-9a-f-]{36}\.(tmp|delete)$/i.test(entry)) continue;
    const stalePath = resolve(stagingDirectory, entry);
    if (stalePath.startsWith(`${stagingDirectory}${sep}`) && statSync(stalePath).isFile()) {
      unlinkSync(stalePath);
    }
  }
  const stagedPortraits = new Map<string, ReadyAssetRegistration>();

  const resolveManagedPath = (assetId: string): string => {
    if (!UUID_PATTERN.test(assetId)) {
      throw new Error("Invalid asset ID.");
    }
    const path = resolve(assetDirectory, assetId);
    if (!path.startsWith(`${assetDirectory}${sep}`)) {
      throw new Error("Asset path escaped the managed directory.");
    }
    return path;
  };

  const copyIntoStage = (
    sourcePath: string,
    assetId: string,
    originalName: string,
  ): ReadyAssetRegistration => {
    const stagingPath = resolve(stagingDirectory, `${assetId}.tmp`);
    try {
      copyFileSync(sourcePath, stagingPath);
      const metadata = inspectPortrait(stagingPath, originalName);
      return {
        id: assetId,
        kind: "character_portrait",
        storageKey: assetId,
        ...metadata,
      };
    } catch (error) {
      if (existsSync(stagingPath)) unlinkSync(stagingPath);
      throw error;
    }
  };

  return {
    stagePortrait: (sourcePath) => {
      const originalName = basename(sourcePath);
      expectedMime(originalName);
      const registration = copyIntoStage(sourcePath, randomUUID(), originalName);
      stagedPortraits.set(registration.id, registration);
      return stagedCharacterPortraitSchema.parse({
        id: registration.id,
        mimeType: registration.mimeType,
        byteSize: registration.byteSize,
        originalName: registration.originalName,
      });
    },
    commitStagedPortrait: (stageId, commit) => {
      const registration = stagedPortraits.get(stageId);
      if (registration === undefined) {
        throw new Error("立绘暂存项不存在或已失效。");
      }
      const stagingPath = resolve(stagingDirectory, `${stageId}.tmp`);
      const finalPath = resolveManagedPath(stageId);
      if (!existsSync(stagingPath) || existsSync(finalPath)) {
        throw new Error("立绘暂存状态无效。");
      }
      renameSync(stagingPath, finalPath);
      try {
        const result = commit(registration);
        stagedPortraits.delete(stageId);
        return result;
      } catch (error) {
        renameSync(finalPath, stagingPath);
        throw error;
      }
    },
    discardStagedPortrait: (stageId) => {
      if (!stagedPortraits.delete(stageId)) {
        throw new Error("立绘暂存项不存在或已失效。");
      }
      const stagingPath = resolve(stagingDirectory, `${stageId}.tmp`);
      if (existsSync(stagingPath)) unlinkSync(stagingPath);
    },
    removeExact: (assetId) => {
      const path = resolveManagedPath(assetId);
      if (existsSync(path)) unlinkSync(path);
    },
    resolveManagedPath,
    resolveStagedPortrait: (stageId) => {
      const registration = stagedPortraits.get(stageId);
      if (registration === undefined) {
        throw new Error("立绘暂存项不存在或已失效。");
      }
      const path = resolve(stagingDirectory, `${stageId}.tmp`);
      if (!path.startsWith(`${stagingDirectory}${sep}`) || !existsSync(path)) {
        throw new Error("立绘暂存状态无效。");
      }
      return {
        path,
        mimeType: registration.mimeType,
        byteSize: registration.byteSize,
      };
    },
    reconcile: (database, config) => {
      for (const asset of database.listAssets()) {
        if (asset.kind !== "character_portrait") continue;
        if (asset.status === "ready") continue;
        const finalPath = resolveManagedPath(asset.id);
        let originalName: string | undefined;

        if (existsSync(finalPath)) {
          const bundledPortrait = config.character.portrait;
          originalName =
            bundledPortrait?.assetId === asset.id ? bundledPortrait.file : undefined;
          if (originalName === undefined) {
            database.markAssetReady(asset.id, inspectStoredPortrait(finalPath, asset.id));
            continue;
          }
        } else {
          const bundledPortrait = config.character.portrait;
          if (bundledPortrait?.assetId === asset.id) {
            const bundledPath = join(characterResourcesPath, bundledPortrait.file);
            if (basename(bundledPortrait.file) !== bundledPortrait.file) {
              throw new Error("Invalid bundled portrait path.");
            }
            if (existsSync(bundledPath)) {
              const registration = copyIntoStage(
                bundledPath,
                asset.id,
                bundledPortrait.file,
              );
              renameSync(
                resolve(stagingDirectory, `${asset.id}.tmp`),
                resolveManagedPath(asset.id),
              );
              database.markAssetReady(asset.id, registration);
              continue;
            }
          }

          for (const extension of Object.keys(PORTRAIT_MIME_BY_EXTENSION)) {
            const legacyPath = join(legacyDirectory, `${asset.id}${extension}`);
            if (!existsSync(legacyPath)) continue;
            const metadata = inspectPortrait(legacyPath, basename(legacyPath));
            renameSync(legacyPath, finalPath);
            database.markAssetReady(asset.id, metadata);
            originalName = undefined;
            break;
          }
        }

        if (originalName !== undefined) {
          database.markAssetReady(asset.id, inspectPortrait(finalPath, originalName));
        }
      }
    },
    importChatAttachment: (request, database) => {
      const data = Buffer.from(request.data);
      if (data.byteLength > CHAT_ATTACHMENT_LIMITS.maxFileBytes) {
        throw new ChatAttachmentError("单个附件不能超过 25 MiB。");
      }
      const id = randomUUID();
      const stagingPath = resolve(stagingDirectory, `${id}.tmp`);
      const finalPath = resolveManagedPath(id);
      const registration: ReadyAssetRegistration = {
        id,
        kind: "chat_attachment",
        storageKey: id,
        mimeType: request.mediaType || DEFAULT_ATTACHMENT_MEDIA_TYPE,
        byteSize: data.byteLength,
        sha256: createHash("sha256").update(data).digest("hex"),
        originalName: request.name,
      };
      try {
        writeFileSync(stagingPath, data, { flag: "wx" });
        renameSync(stagingPath, finalPath);
        try {
          return database.registerReadyAsset(registration);
        } catch (error) {
          try {
            database.deleteUnreferencedChatAttachment(id);
          } catch {
            // Preserve the original database failure.
          }
          if (existsSync(finalPath)) unlinkSync(finalPath);
          throw error;
        }
      } catch (error) {
        if (existsSync(stagingPath)) unlinkSync(stagingPath);
        throw error;
      }
    },
    readChatAttachment: (assetId, database) => {
      let asset: Asset;
      try {
        asset = database.fetchAsset(assetId);
      } catch {
        throw new ChatAttachmentError("附件不存在或已被清理。");
      }
      const filename = asset.originalName ?? assetId;
      if (
        asset.kind !== "chat_attachment" ||
        asset.status !== "ready" ||
        asset.byteSize === null ||
        asset.sha256 === null ||
        asset.mimeType === null ||
        asset.originalName === null
      ) {
        throw new ChatAttachmentError(`附件“${filename}”不可用。`);
      }
      if (asset.byteSize > CHAT_ATTACHMENT_LIMITS.maxFileBytes) {
        throw new ChatAttachmentError(`附件“${filename}”超过 25 MiB 限制。`);
      }
      const path = resolveManagedPath(assetId);
      if (!existsSync(path) || !statSync(path).isFile()) {
        throw new ChatAttachmentError(`附件“${filename}”的托管副本不存在。`);
      }
      const content = readFileSync(path);
      const sha256 = createHash("sha256").update(content).digest("hex");
      if (content.byteLength !== asset.byteSize || sha256 !== asset.sha256) {
        throw new ChatAttachmentError(`附件“${filename}”完整性校验失败。`);
      }
      return {
        data: new Uint8Array(content),
        mediaType: asset.mimeType,
        filename: asset.originalName,
      };
    },
    releaseChatAttachment: (assetId, database) => {
      const finalPath = resolveManagedPath(assetId);
      const deletionPath = resolve(stagingDirectory, `${assetId}.delete`);
      let moved = false;
      if (existsSync(finalPath)) {
        if (existsSync(deletionPath)) unlinkSync(deletionPath);
        renameSync(finalPath, deletionPath);
        moved = true;
      }
      try {
        const deleted = database.deleteUnreferencedChatAttachment(assetId);
        if (!deleted) {
          if (moved) renameSync(deletionPath, finalPath);
          return false;
        }
        if (moved && existsSync(deletionPath)) unlinkSync(deletionPath);
        return true;
      } catch (error) {
        if (moved && existsSync(deletionPath)) renameSync(deletionPath, finalPath);
        throw error;
      }
    },
    cleanupUnreferencedChatAttachments: (database) => {
      for (const assetId of database.listUnreferencedChatAttachmentIds()) {
        try {
          const finalPath = resolveManagedPath(assetId);
          if (existsSync(finalPath)) unlinkSync(finalPath);
          database.deleteUnreferencedChatAttachment(assetId);
        } catch {
          // Startup/message cleanup is best-effort; the next reconciliation retries it.
        }
      }
    },
  };
}
