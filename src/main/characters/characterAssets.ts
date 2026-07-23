import { randomUUID } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { basename, extname, join } from "node:path";
import type { DefaultCharacterConfig } from "../../shared/characters";

const MAX_PORTRAIT_BYTES = 10 * 1024 * 1024;
const PORTRAIT_TYPES = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
} as const;

type PortraitExtension = keyof typeof PORTRAIT_TYPES;

export interface CharacterAssetStore {
  ensureDefaultPortrait(config: DefaultCharacterConfig): void;
  importPortrait(sourcePath: string): string;
  readPortraitDataUrl(assetId: string): string | null;
  deletePortrait(assetId: string): void;
}

interface CreateCharacterAssetStoreOptions {
  readonly userDataPath: string;
  readonly characterResourcesPath: string;
}

function portraitExtension(filePath: string): PortraitExtension {
  const extension = extname(filePath).toLocaleLowerCase();
  if (!(extension in PORTRAIT_TYPES)) {
    throw new Error("仅支持 PNG、JPEG 和 WebP 立绘。");
  }
  return extension as PortraitExtension;
}

export function createCharacterAssetStore({
  userDataPath,
  characterResourcesPath,
}: CreateCharacterAssetStoreOptions): CharacterAssetStore {
  const assetDirectory = join(userDataPath, "character-assets");
  mkdirSync(assetDirectory, { recursive: true });

  const findAsset = (assetId: string): { readonly path: string; readonly extension: PortraitExtension } | null => {
    for (const extension of Object.keys(PORTRAIT_TYPES) as PortraitExtension[]) {
      const path = join(assetDirectory, `${assetId}${extension}`);
      if (existsSync(path)) return { path, extension };
    }
    return null;
  };

  return {
    ensureDefaultPortrait: (config) => {
      const portrait = config.character.portrait;
      if (portrait === null || findAsset(portrait.assetId) !== null) return;

      const sourcePath = join(characterResourcesPath, portrait.file);
      if (basename(portrait.file) !== portrait.file) {
        throw new Error("Invalid bundled portrait path.");
      }
      const extension = portraitExtension(sourcePath);
      copyFileSync(sourcePath, join(assetDirectory, `${portrait.assetId}${extension}`));
    },
    importPortrait: (sourcePath) => {
      const extension = portraitExtension(sourcePath);
      const size = statSync(sourcePath).size;
      if (size > MAX_PORTRAIT_BYTES) {
        throw new Error("立绘文件不能超过 10 MiB。");
      }

      const assetId = randomUUID();
      copyFileSync(sourcePath, join(assetDirectory, `${assetId}${extension}`));
      return assetId;
    },
    readPortraitDataUrl: (assetId) => {
      const asset = findAsset(assetId);
      if (asset === null) return null;
      const content = readFileSync(asset.path);
      return `data:${PORTRAIT_TYPES[asset.extension]};base64,${content.toString("base64")}`;
    },
    deletePortrait: (assetId) => {
      const asset = findAsset(assetId);
      if (asset !== null) unlinkSync(asset.path);
    },
  };
}
