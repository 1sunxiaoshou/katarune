import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, utimes } from "node:fs/promises";
import { join } from "node:path";
import type { ProviderType } from "../../shared/ipc";
import { createSpeechCacheFiles } from "./speechCacheFiles";

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
  const files = createSpeechCacheFiles(directory, maxBytes, CACHE_FILE_PATTERN, { removeEmpty: true });
  let initialized: Promise<void> | undefined;

  const prepareDirectory = async (): Promise<void> => {
    await mkdir(directory, { recursive: true });
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isFile() && (entry.name.includes(".tmp-") || entry.name.endsWith(".tmp"))) {
        await rm(join(directory, entry.name), { force: true });
      }
    }
    await files.prune();
  };

  const ensureInitialized = (): Promise<void> => {
    initialized ??= prepareDirectory();
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
          await rm(path, { force: true });
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
      if (abortSignal?.aborted) return;
      try {
        await files.put(cachePath(key, format), () => audio, abortSignal);
      } catch (error) {
        if (abortSignal?.aborted && (
          error === abortSignal.reason || (error instanceof Error && error.name === "AbortError")
        )) return;
        throw error;
      }
    },
  };
}
