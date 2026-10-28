// This worker is the only normal log writer. Synchronous library I/O runs off
// the main event loop; one acknowledged batch provides bounded backpressure.
import { parentPort, workerData } from "node:worker_threads";
import { mkdirSync, readdirSync, statSync, renameSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import log from "electron-log/node";

const directory: string = workerData.directory;
const logger = log.create({ logId: "diagnostics" });
logger.transports.console.level = false;
logger.transports.file.format = "{text}";
logger.transports.file.sync = true;
logger.transports.file.maxSize = 5 * 1024 * 1024;
logger.transports.file.resolvePathFn = () => join(directory, "events.jsonl");
let failed = false;
// electron-log routes internal transport failures to this logger's console.
// Override that transport so it cannot print raw filesystem paths or recurse.
logger.transports.console.writeFn = () => { failed = true; };
let archiveSequence = 0;
logger.transports.file.archiveLogFn = file => {
  renameSync(file.toString(), join(directory, `events-${Date.now()}-${archiveSequence++}.jsonl`));
};
function retain() {
  const files = readdirSync(directory).filter(name => /^events(?:-\d+-\d+)?\.jsonl$/.test(name)).map(name => ({ name, ...statSync(join(directory, name)) })).sort((a, b) => b.mtimeMs - a.mtimeMs);
  let bytes = 0, count = 0;
  for (const file of files) {
    if (file.name !== "events.jsonl" && (Date.now() - file.mtimeMs > 7 * 86400_000 || bytes + file.size > 50 * 1024 * 1024)) rmSync(join(directory, file.name));
    else { bytes += file.size; count++; }
  }
  return { bytes, files: count };
}
parentPort?.on("message", (lines: string[]) => {
  failed = false;
  try {
    mkdirSync(directory, { recursive: true });
    const marker = join(directory, "session.pending");
    if (!existsSync(marker)) writeFileSync(marker, workerData.bootId);
    const current = join(directory, "events.jsonl");
    try {
      if (Date.now() - statSync(current).birthtimeMs > 86400_000) {
        // Rotate at least daily so a quiet active file cannot retain old events forever.
        logger.transports.file.maxSize = 1;
      }
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error;
    }
    for (const line of lines) { logger.info(line); logger.transports.file.maxSize = 5 * 1024 * 1024; }
    parentPort?.postMessage({ failed, ...retain() });
  } catch { parentPort?.postMessage({ failed: true, bytes: 0, files: 0 }); }
});
