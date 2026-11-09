import { rename, rm, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

/** Replace only after a complete write; Windows readers may briefly lock rename. */
export async function writeDesktopPreferences(file: string, contents: string): Promise<void> {
  const staging = `${file}.tmp`;
  try {
    await writeFile(staging, contents, "utf8");
    for (let attempt = 0; ; attempt++) {
      try { await rename(staging, file); return; }
      catch (error) {
        const retryable = error && typeof error === "object" && "code" in error
          && ["EPERM", "EACCES", "EBUSY"].includes(String(error.code));
        if (!retryable || attempt >= 5) throw error;
        await delay(25 * 2 ** attempt);
      }
    }
  } finally {
    await rm(staging, { force: true }).catch(() => {});
  }
}
