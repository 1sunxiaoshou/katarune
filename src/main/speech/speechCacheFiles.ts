import { randomUUID } from "node:crypto";
import { readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function statCacheFile(path: string) {
  try {
    return await stat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return undefined;
  }
}

export function createSpeechCacheFiles(
  directory: string,
  maxBytes: number,
  entryPattern: RegExp,
  { removeEmpty = false } = {},
) {
  let writes = Promise.resolve();

  async function prune(): Promise<void> {
    const files: { path: string; size: number; mtimeMs: number }[] = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (!entry.isFile() || !entryPattern.test(entry.name)) continue;
      const path = join(directory, entry.name);
      const metadata = await statCacheFile(path);
      if (!metadata) continue;
      if (removeEmpty && metadata.size === 0) {
        await rm(path, { force: true });
        continue;
      }
      files.push({ path, size: metadata.size, mtimeMs: metadata.mtimeMs });
    }

    let totalBytes = files.reduce((sum, file) => sum + file.size, 0);
    for (const file of files.sort((left, right) => left.mtimeMs - right.mtimeMs)) {
      if (totalBytes <= maxBytes) break;
      await rm(file.path, { force: true });
      totalBytes -= file.size;
    }
  }

  function put(path: string, contents: () => string | Uint8Array, signal?: AbortSignal): Promise<void> {
    const write = writes.then(async () => {
      signal?.throwIfAborted();
      const temporary = `${path}.tmp-${randomUUID()}`;
      try {
        await writeFile(temporary, contents(), { flag: "wx", signal });
        signal?.throwIfAborted();
        try {
          await rename(temporary, path);
        } catch (error) {
          // A valid entry for this key may already have been published.
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        }
      } finally {
        await rm(temporary, { force: true });
      }
      await prune();
    });
    writes = write.catch(() => undefined);
    return write;
  }

  return { prune, put };
}
