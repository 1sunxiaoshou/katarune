import { createHash } from "node:crypto";
import { mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createSpeechCacheKey,
  createTtsCache,
  isSafeAudioFormat,
  TTS_CACHE_VERSION,
} from "../src/main/speech/ttsCache";

const temporaryDirectories: string[] = [];

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "katarune-tts-cache-"));
  temporaryDirectories.push(directory);
  return directory;
}

function mp3(seed: number, size = 8): Uint8Array {
  const audio = new Uint8Array(size);
  audio.set([0x49, 0x44, 0x33, seed]);
  return audio;
}

function wav(seed: number, size = 48): Uint8Array {
  const audio = new Uint8Array(size);
  audio.set([0x52, 0x49, 0x46, 0x46, seed, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]);
  return audio;
}

const isMp3 = (audio: Uint8Array): boolean =>
  audio.byteLength >= 3 &&
  audio[0] === 0x49 &&
  audio[1] === 0x44 &&
  audio[2] === 0x33;
const isWav = (audio: Uint8Array): boolean =>
  audio.byteLength >= 44 &&
  audio[0] === 0x52 &&
  audio[1] === 0x49 &&
  audio[2] === 0x46 &&
  audio[3] === 0x46 &&
  audio[8] === 0x57 &&
  audio[9] === 0x41 &&
  audio[10] === 0x56 &&
  audio[11] === 0x45;

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("TTS content-addressed cache", () => {
  it("creates a stable fingerprint and invalidates changed synthesis inputs", () => {
    const input = {
      text: " hello ",
      providerType: "openai" as const,
      baseUrl: null,
      modelId: "gpt-4o-mini-tts",
      voice: "alloy",
      outputFormat: "wav",
    };
    expect(createSpeechCacheKey(input)).toBe(createSpeechCacheKey({ ...input }));
    expect(createSpeechCacheKey(input)).not.toBe(
      createSpeechCacheKey({ ...input, voice: "nova" }),
    );
    expect(createSpeechCacheKey(input)).not.toBe(
      createSpeechCacheKey({ ...input, baseUrl: "https://example.com/v1" }),
    );
    expect(createSpeechCacheKey(input)).not.toBe(
      createSpeechCacheKey({ ...input, text: "hello" }),
    );
    expect(createSpeechCacheKey(input)).not.toBe(
      createSpeechCacheKey({ ...input, outputFormat: "mp3" }),
    );
    const legacyKey = createHash("sha256")
      .update(JSON.stringify({ version: 1, ...input }), "utf8")
      .digest("hex");
    expect(TTS_CACHE_VERSION).toBe(2);
    expect(createSpeechCacheKey(input)).not.toBe(legacyKey);
  });

  it("writes multiple formats atomically and leaves no temporary files", async () => {
    const directory = await createTemporaryDirectory();
    const cache = createTtsCache({ directory, maxBytes: 200 });
    const key = "a".repeat(64);
    const wavAudio = wav(1);
    const mp3Audio = mp3(2);

    await cache.put(key, "wav", wavAudio, isWav);
    await cache.put(key, "mp3", mp3Audio, isMp3);

    expect(await cache.get(key, "wav", isWav)).toEqual(wavAudio);
    expect(await cache.get(key, "mp3", isMp3)).toEqual(mp3Audio);
    expect((await readdir(directory)).sort()).toEqual(
      [`${key}.mp3`, `${key}.wav`].sort(),
    );
  });

  it("deletes corrupt entries and startup temporary files", async () => {
    const directory = await createTemporaryDirectory();
    const key = "b".repeat(64);
    const path = join(directory, `${key}.wav`);
    await writeFile(path, new Uint8Array([1, 2, 3]));
    await writeFile(join(directory, `${key}.tmp-leftover`), wav(2));
    const cache = createTtsCache({ directory, maxBytes: 200 });

    await cache.initialize();

    expect(await readdir(directory)).toEqual([`${key}.wav`]);
    expect(await cache.get(key, "wav", isWav)).toBeNull();
    await expect(stat(path)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readdir(directory)).toEqual([]);
  });

  it("prunes least-recent files and does not cache a result over the limit", async () => {
    const directory = await createTemporaryDirectory();
    const cache = createTtsCache({ directory, maxBytes: 84 });
    const firstKey = "c".repeat(64);
    const secondKey = "d".repeat(64);

    await cache.put(firstKey, "wav", wav(1, 48), isWav);
    await cache.put(secondKey, "wav", wav(2, 48), isWav);

    expect(await cache.get(firstKey, "wav", isWav)).toBeNull();
    expect(await cache.get(secondKey, "wav", isWav)).not.toBeNull();
    await cache.put("e".repeat(64), "wav", wav(3, 85), isWav);
    expect(await cache.get("e".repeat(64), "wav", isWav)).toBeNull();
  });

  it("rejects unsafe cache extensions", () => {
    expect(isSafeAudioFormat("wav")).toBe(true);
    expect(isSafeAudioFormat("mpeg_4")).toBe(true);
    expect(isSafeAudioFormat("../wav")).toBe(false);
    expect(isSafeAudioFormat("WAV")).toBe(false);
  });
});
