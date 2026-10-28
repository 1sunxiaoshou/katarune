import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile, utimes, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { build } from "esbuild";
import { APICallError, RetryError } from "ai";
import { Diagnostics } from "../src/main/diagnostics/logger";
import { projectErrorChain, rendererDiagnosticSchema } from "../src/shared/diagnostics";

let directory: string, writer: string;
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "katarune-diagnostics-test-"));
  writer = join(directory, "writer.cjs");
  await build({ entryPoints: [resolve("src/main/diagnostics/diagnosticWriter.ts")], outfile: writer, bundle: true, platform: "node", format: "cjs" });
});
afterAll(async () => { await rm(directory, { recursive: true, force: true }); });

describe("diagnostic privacy and resource bounds", () => {
  it("keeps HTTP and nested causes without provider bodies, messages, URLs or user paths", () => {
    const cause = new APICallError({ message: "private chat", url: "https://secret.invalid?key=secret-token", requestBodyValues: { text: "private chat" }, responseBody: "private response", statusCode: 429, isRetryable: true });
    cause.stack = "Error: private chat\n at request (C:\\Users\\private-name\\repo\\src\\main\\speech\\ttsService.ts:123:4)";
    const error = new RetryError({ message: "private response", reason: "maxRetriesExceeded", errors: [cause] });
    const chain = projectErrorChain(new Error("private token", { cause: error }));
    expect(chain.at(-1)).toMatchObject({ name: "AI_APICallError", httpStatus: 429, retryable: true, frames: ["src/main/speech/ttsService.ts:123:4"] });
    expect(JSON.stringify(chain)).not.toMatch(/private|secret|https|Users|requestBody|responseBody/);
  });
  it("handles hostile getters and circular causes without throwing", () => {
    const error = { get name() { throw new Error(); }, cause: undefined as unknown };
    error.cause = error;
    expect(projectErrorChain(error)).toHaveLength(1);
    expect(rendererDiagnosticSchema.safeParse({ event: "renderer.error", error: { name: "Error", frames: Array(13).fill("a"), messageRedacted: true } }).success).toBe(false);
  });
  it("bounds event floods and only enables debug temporarily", () => {
    const logger = new Diagnostics(join(directory, "unused"), "test");
    logger.record("debug", "test.hidden");
    expect(logger.memorySnapshot()).toHaveLength(0);
    logger.debug(true);
    for (let i = 0; i < 1000; i++) logger.record("info", "test.event", { count: i });
    expect(logger.status().queued).toBe(512);
    expect(logger.status().dropped).toBe(489);
    logger.debug(false);
    expect(logger.status().debugUntil).toBe(0);
  });
  it("returns the recorded incident for the same error and repeated failures", () => {
    const logger = new Diagnostics(join(directory, "incidents"), "test");
    const error = new Error("secret");
    const first = logger.record("error", "test.failed", {}, error);
    expect(logger.record("error", "test.failed", {}, error)).toBe(first);
    expect(logger.memorySnapshot()).toHaveLength(1);
  });
  it("writes valid JSONL in a worker and removes the marker only after a clean flush", async () => {
    const path = join(directory, "normal"), logger = new Diagnostics(path, "test");
    logger.start(writer);
    logger.record("error", "tts.failed", { runId: "test-run", dialogueId: "test-dialogue" }, { name: "AI_APICallError", statusCode: 429, message: "never write this" });
    await logger.close(true);
    const entries = (await readFile(join(path, "events.jsonl"), "utf8")).trim().split("\n").map(line => JSON.parse(line));
    expect(entries.map(entry => entry.event)).toEqual(["app.started", "tts.failed", "app.stopped"]);
    expect(entries[1].error[0].httpStatus).toBe(429);
    expect(await readdir(path)).not.toContain("session.pending");
    expect(JSON.stringify(entries)).not.toContain("never write this");
  });
  it("retains unclean markers, reports the next start, and survives unwritable paths", async () => {
    const path = join(directory, "unclean"), first = new Diagnostics(path, "test");
    first.start(writer); await first.close(false);
    const second = new Diagnostics(path, "test"); second.start(writer); await second.close(true);
    expect(await readFile(join(path, "events.jsonl"), "utf8")).toContain("app.previous-unclean-exit");
    const blocked = join(directory, "not-a-directory"); await writeFile(blocked, "fixture");
    const broken = new Diagnostics(blocked, "test"); broken.start(writer);
    await broken.flush(250);
    expect(broken.status().degraded).toBe(true);
    expect(broken.memorySnapshot().length).toBeGreaterThan(0);
    await broken.close(false);
  });
  it("removes expired archives and enforces the directory byte budget", async () => {
    const path = join(directory, "retention"); await mkdir(path);
    const expired = join(path, "events-1-0.jsonl"); await writeFile(expired, "expired");
    const old = new Date(Date.now() - 8 * 86400_000); await utimes(expired, old, old);
    for (let i = 2; i < 13; i++) await writeFile(join(path, `events-${i}-0.jsonl`), Buffer.alloc(5 * 1024 * 1024, " "));
    const logger = new Diagnostics(path, "test"); logger.start(writer); await logger.close(true);
    const names = await readdir(path);
    expect(names).not.toContain("events-1-0.jsonl");
    let total = 0;
    for (const name of names) total += (await stat(join(path, name))).size;
    expect(total).toBeLessThanOrEqual(50 * 1024 * 1024);
  });
  it("recovers after the blocked directory becomes writable and drains the safe fallback", async () => {
    const path = join(directory, "recovering"); await writeFile(path, "fixture");
    const logger = new Diagnostics(path, "test"); logger.start(writer);
    try {
      logger.record("error", "test.disk-failure", {}, { name: "Error", code: "ENOSPC", message: "private-disk-fixture" });
      await logger.flush(300);
      expect(logger.status().degraded).toBe(true);
      await rm(path); await mkdir(path);
      const deadline = Date.now() + 13_000;
      while (logger.status().degraded && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100));
      expect(logger.status().degraded).toBe(false);
      await logger.flush();
      const content = await readFile(join(path, "events.jsonl"), "utf8");
      expect(content).toContain("diagnostics.recovered");
      expect(content).toContain("ENOSPC");
      expect(content).not.toContain("private-disk-fixture");
    } finally { await logger.close(true); }
  }, 16_000);
});
