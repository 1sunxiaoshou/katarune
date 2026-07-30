import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  stat,
  unlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import type { ProviderType } from "../../shared/ipc";

export const TTS_CACHE_MAX_BYTES = 512 * 1024 * 1024;
export const TTS_CACHE_VERSION = 2;
const SAFE_AUDIO_FORMAT_PATTERN = /^[a-z0-9][a-z0-9_-]{0,15}$/;
const CACHE_FILE_PATTERN = /^[a-f0-9]{64}\.[a-z0-9][a-z0-9_-]{0,15}$/;

export interface SpeechCacheFingerprint {
  readonly text: string;
  readonly providerType: ProviderType;
  readonly baseUrl: string | null;
  readonly modelId: string;
  readonly voice: string;
  readonly outputFormat: string;
}

export interface TtsCache {
  initialize(): Promise<void>;
  get(
    key: string,
    format: string,
    validateAudio: (audio: Uint8Array) => boolean,
  ): Promise<Uint8Array | null>;
  put(
    key: string,
    format: string,
    audio: Uint8Array,
    validateAudio: (audio: Uint8Array) => boolean,
    abortSignal?: AbortSignal,
  ): Promise<void>;
}

export function createSpeechCacheKey(fingerprint: SpeechCacheFingerprint): string {
  if (!isSafeAudioFormat(fingerprint.outputFormat)) {
    throw new Error(`Unsafe speech output format "${fingerprint.outputFormat}".`);
  }
  return createHash("sha256")
    .update(
      JSON.stringify({
        version: TTS_CACHE_VERSION,
        ...fingerprint,
      }),
      "utf8",
    )
    .digest("hex");
}

export function isSafeAudioFormat(format: string): boolean {
  return SAFE_AUDIO_FORMAT_PATTERN.test(format);
}

export function createTtsCache({
  directory,
  maxBytes = TTS_CACHE_MAX_BYTES,
}: {
  readonly directory: string;
  readonly maxBytes?: number;
}): TtsCache {
  let initialized: Promise<void> | undefined;
  let writeQueue = Promise.resolve();

  const removeIfPresent = async (path: string): Promise<void> => {
    await unlink(path).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    });
  };

  const prune = async (): Promise<void> => {
    await mkdir(directory, { recursive: true });
    const entries = await readdir(directory, { withFileTypes: true });
    const cacheFiles: Array<{
      readonly path: string;
      readonly size: number;
      readonly mtimeMs: number;
    }> = [];

    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (
        entry.isFile() &&
        (entry.name.includes(".tmp-") || entry.name.endsWith(".tmp"))
      ) {
        await removeIfPresent(path);
        continue;
      }
      if (!entry.isFile() || !CACHE_FILE_PATTERN.test(entry.name)) continue;
      const metadata = await stat(path);
      if (metadata.size === 0) {
        await removeIfPresent(path);
        continue;
      }
      cacheFiles.push({
        path,
        size: metadata.size,
        mtimeMs: metadata.mtimeMs,
      });
    }

    let totalBytes = cacheFiles.reduce((sum, file) => sum + file.size, 0);
    cacheFiles.sort((left, right) => left.mtimeMs - right.mtimeMs);
    for (const file of cacheFiles) {
      if (totalBytes <= maxBytes) break;
      await removeIfPresent(file.path);
      totalBytes -= file.size;
    }
  };

  const ensureInitialized = (): Promise<void> => {
    initialized ??= prune();
    return initialized;
  };

  const cachePath = (key: string, format: string): string => {
    if (!/^[a-f0-9]{64}$/.test(key) || !isSafeAudioFormat(format)) {
      throw new Error("Invalid TTS cache key or audio format.");
    }
    return join(directory, `${key}.${format}`);
  };

  return {
    initialize: ensureInitialized,
    get: async (key, format, validateAudio) => {
      await ensureInitialized();
      const path = cachePath(key, format);
      try {
        const audio = new Uint8Array(await readFile(path));
        if (audio.byteLength === 0 || !validateAudio(audio)) {
          await removeIfPresent(path);
          return null;
        }
        const now = new Date();
        await utimes(path, now, now);
        return audio;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }
    },
    put: async (key, format, audio, validateAudio, abortSignal) => {
      if (
        !isSafeAudioFormat(format) ||
        !validateAudio(audio) ||
        audio.byteLength > maxBytes
      ) {
        return;
      }
      await ensureInitialized();
      const task = writeQueue.then(async () => {
        if (abortSignal?.aborted) return;
        const destination = cachePath(key, format);
        const temporary = join(directory, `${key}.tmp-${randomUUID()}`);
        try {
          await writeFile(temporary, audio, { flag: "wx" });
          if (abortSignal?.aborted) return;
          await rename(temporary, destination).catch(async (error: unknown) => {
            if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
            await removeIfPresent(temporary);
          });
          await prune();
        } finally {
          await removeIfPresent(temporary);
        }
      });
      writeQueue = task.catch(() => undefined);
      await task;
    },
  };
}
