// This worker is the only normal log writer. Synchronous library I/O runs off
// the main event loop; one acknowledged batch provides bounded backpressure.
import { parentPort, workerData } from "node:worker_threads";
import { mkdirSync, readdirSync, statSync, renameSync, rmSync, existsSync, writeFileSync, openSync, readSync, closeSync } from "node:fs";
import { join } from "node:path";
import log from "electron-log/node";
import { diagnosticRecordSchema } from "../../shared/diagnostics";

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
let activeFileStartedAt: number | undefined;
logger.transports.file.archiveLogFn = file => {
  renameSync(file.toString(), join(directory, `events-${Date.now()}-${archiveSequence++}.jsonl`));
  activeFileStartedAt = Date.now();
};
function readActiveFileStartedAt(path: string) {
  const info = statSync(path);
  const descriptor = openSync(path, "r");
  let firstLine: string;
  try {
    // One bounded record, read only when the writer starts. Windows may preserve
    // birthtime when events.jsonl is recreated, so use the first received event.
    const buffer = Buffer.alloc(8192 + 2);
    const length = readSync(descriptor, buffer, 0, buffer.length, 0);
    firstLine = buffer.toString("utf8", 0, length).split("\n", 1)[0] ?? "";
  } finally { closeSync(descriptor); }
  let value: unknown;
  try { value = JSON.parse(firstLine); } catch { return info.mtimeMs; }
  const record = diagnosticRecordSchema.safeParse(value);
  return record.success ? Date.parse(record.data.observedTimestamp) : info.mtimeMs;
}
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
    if (activeFileStartedAt === undefined) {
      try { activeFileStartedAt = readActiveFileStartedAt(current); }
      catch (error) {
        if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error;
        activeFileStartedAt = Date.now();
      }
    }
    // Rotate at least daily, even when writes continuously refresh mtime.
    logger.transports.file.maxSize = Date.now() - activeFileStartedAt > 86400_000 ? 1 : 5 * 1024 * 1024;
    for (const line of lines) { logger.info(line); logger.transports.file.maxSize = 5 * 1024 * 1024; }
    parentPort?.postMessage({ failed, ...retain() });
  } catch { parentPort?.postMessage({ failed: true, bytes: 0, files: 0 }); }
});
