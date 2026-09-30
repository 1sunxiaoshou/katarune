import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { validateSpeechSegments } from "../../shared/speechTiming";
import type { TimestampedSpeechAudio } from "../ai/timestampedSpeech";

export function createSpeechArtifactCache(root: string, maxBytes = 512 * 1024 * 1024) {
  const directory = join(root, "timestamped-v1");
  let writes = Promise.resolve();
  let initialized: Promise<void> | undefined;
  const initialize = () => initialized ??= (async () => {
    await mkdir(directory, { recursive: true });
    for (const name of await readdir(directory)) {
      if (!/^[a-f0-9]{64}\.json\.tmp-[a-f0-9-]{36}$/.test(name)) continue;
      const path = join(directory, name);
      if (Date.now() - (await stat(path)).mtimeMs > 86_400_000) await rm(path, { force: true });
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
        if ((await stat(filename(key))).size > maxBytes) return null;
        const value = JSON.parse(await readFile(filename(key), "utf8"));
        if (value.version !== 1 || value.format !== "wav" || value.mediaType !== "audio/wav" || typeof value.audio !== "string") return null;
        const audio = new Uint8Array(Buffer.from(value.audio, "base64"));
        if (createHash("sha256").update(audio).digest("hex") !== value.hash) return null;
        const segments = validateSpeechSegments(value.segments);
        if (value.segments !== undefined && !segments) return null;
        return { audio, format: "wav", mediaType: "audio/wav", ...(segments ? { segments } : {}) };
      } catch { return null; }
    },
    async put(key: string, result: TimestampedSpeechAudio, signal: AbortSignal) {
      const operation = writes.then(async () => {
        signal.throwIfAborted();
        await initialize();
        const target = filename(key);
        const temporary = `${target}.tmp-${randomUUID()}`;
        try {
          await writeFile(temporary, JSON.stringify({ version: 1, ...result,
            audio: Buffer.from(result.audio).toString("base64"),
            hash: createHash("sha256").update(result.audio).digest("hex"),
          }), { signal });
          signal.throwIfAborted();
          await rename(temporary, target);
        } finally { await rm(temporary, { force: true }); }
        const files = await Promise.all((await readdir(directory)).filter(name => /^[a-f0-9]{64}\.json$/.test(name))
          .map(async name => ({ path: join(directory, name), ...await stat(join(directory, name)) })));
        let size = files.reduce((total, item) => total + item.size, 0);
        for (const item of files.sort((a, b) => a.mtimeMs - b.mtimeMs)) {
          if (size <= maxBytes) break;
          await rm(item.path, { force: true }); size -= item.size;
        }
      });
      writes = operation.catch(() => {});
      return operation;
    },
  };
}
