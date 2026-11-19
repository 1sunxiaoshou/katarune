import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { validateSpeechSegments } from "../../shared/speechTiming";
import type { TimestampedSpeechAudio } from "../ai/timestampedSpeech";
import { createSpeechCacheFiles, statCacheFile } from "./speechCacheFiles";

export function createSpeechArtifactCache(root: string, maxBytes = 512 * 1024 * 1024) {
  const directory = join(root, "timestamped-v1");
  const files = createSpeechCacheFiles(directory, maxBytes, /^[a-f0-9]{64}\.json$/);
  let initialized: Promise<void> | undefined;
  const initialize = () => initialized ??= (async () => {
    await mkdir(directory, { recursive: true });
    for (const name of await readdir(directory)) {
      if (!/^[a-f0-9]{64}\.json\.tmp-[a-f0-9-]{36}$/.test(name)) continue;
      const path = join(directory, name);
      const metadata = await statCacheFile(path);
      if (metadata && Date.now() - metadata.mtimeMs > 86_400_000) await rm(path, { force: true });
    }
  })();
  const filename = (key: string) => {
    if (!/^[a-f0-9]{64}$/.test(key)) throw new Error("Invalid speech cache key.");
    return join(directory, `${key}.json`);
  };
  return {
    async get(key: string): Promise<TimestampedSpeechAudio | null> {
      try {
        await initialize();
        const path = filename(key);
        if ((await stat(path)).size > maxBytes) return null;
        const value = JSON.parse(await readFile(path, "utf8"));
        if (value.version !== 1 || value.format !== "wav" || value.mediaType !== "audio/wav" || typeof value.audio !== "string") return null;
        const audio = new Uint8Array(Buffer.from(value.audio, "base64"));
        if (createHash("sha256").update(audio).digest("hex") !== value.hash) return null;
        const segments = validateSpeechSegments(value.segments);
        if (value.segments !== undefined && !segments) return null;
        return { audio, format: "wav", mediaType: "audio/wav", ...(segments ? { segments } : {}) };
      } catch { return null; }
    },
    async put(key: string, result: TimestampedSpeechAudio, signal: AbortSignal) {
      signal.throwIfAborted();
      await initialize();
      await files.put(filename(key), () => JSON.stringify({
        version: 1,
        ...result,
        audio: Buffer.from(result.audio).toString("base64"),
        hash: createHash("sha256").update(result.audio).digest("hex"),
      }), signal);
    },
  };
}
