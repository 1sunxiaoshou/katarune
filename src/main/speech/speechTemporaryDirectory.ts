import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { join } from "node:path";

// Only session directories created by this module are eligible for recovery cleanup.
export async function createSpeechTemporaryDirectory(root: string): Promise<string> {
  await mkdir(root, { recursive: true });
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const match = /^session-(\d+)-[a-zA-Z0-9]+$/.exec(entry.name);
    if (!entry.isDirectory() || !match) continue;
    try { process.kill(Number(match[1]), 0); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH")
        await rm(join(root, entry.name), { recursive: true, force: true }).catch(() => {});
    }
  }
  return mkdtemp(join(root, `session-${process.pid}-`));
}
