import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { Worker } from "node:worker_threads";
import { join } from "node:path";
import { mkdirSync, existsSync, writeFileSync, rmSync } from "node:fs";
import { projectErrorChain, PROCESS_EXIT_REASONS, type DiagnosticStatus } from "../../shared/diagnostics";

type Level = "debug" | "info" | "warn" | "error" | "fatal";
type Source = { source: "main" | "renderer" | "unity" | "asr"; processInstanceId: string; sourceSequence?: number; timestamp?: string };
const operationContext = new AsyncLocalStorage<DiagnosticContext>();
export function withDiagnosticContext<T>(context: DiagnosticContext, run: () => T): T { return operationContext.run({ ...operationContext.getStore(), ...safeContext(context) }, run); }
export type DiagnosticContext = {
  operationId?: string; parentOperationId?: string; runId?: string; dialogueId?: string;
  toolCallId?: string; performanceId?: string; bindingEpoch?: number; durationMs?: number;
  attempt?: number; exitCode?: number; count?: number;
  reason?: string; processKind?: "renderer" | "utility" | "gpu" | "other";
  outcome?: "success" | "failed" | "cancelled" | "degraded" | "spoken" | "chat-only";
};
const identifier = /^[A-Za-z0-9_-]{1,100}$/;
export function safeContext(context: DiagnosticContext): DiagnosticContext {
  const safe: DiagnosticContext = {};
  for (const key of ["operationId", "parentOperationId", "runId", "dialogueId", "toolCallId", "performanceId"] as const) {
    const value = context[key]; if (value && identifier.test(value)) safe[key] = value;
  }
  for (const key of ["bindingEpoch", "durationMs", "attempt", "exitCode", "count"] as const) {
    const value = context[key]; if (typeof value === "number" && Number.isFinite(value)) safe[key] = value;
  }
  if (context.outcome && ["success", "failed", "cancelled", "degraded", "spoken", "chat-only"].includes(context.outcome)) safe.outcome = context.outcome;
  if (context.reason && PROCESS_EXIT_REASONS.some(value => value === context.reason)) safe.reason = context.reason;
  if (context.processKind && ["renderer", "utility", "gpu", "other"].includes(context.processKind)) safe.processKind = context.processKind;
  return safe;
}
export class Diagnostics {
  readonly bootId = randomUUID();
  private sequence = 0;
  private worker: Worker | undefined;
  private queue: string[] = [];
  private inFlight: string[] = [];
  private fallback: string[] = [];
  private timer?: ReturnType<typeof setInterval>;
  private retryAt = 0;
  private debugUntil = 0;
  private dropped = 0;
  private degraded = false;
  private bytes = 0;
  private files = 0;
  private writerPath = join(__dirname, "diagnosticWriter.js");
  private closing = false;
  private repeats = new Map<string, { count: number; last: number; incidentId: string }>();
  private incidents = new WeakMap<object, string>();
  constructor(readonly directory: string, readonly version: string) {}
  start(writerPath = join(__dirname, "diagnosticWriter.js")) {
    this.writerPath = writerPath;
    try {
      mkdirSync(this.directory, { recursive: true });
      const marker = join(this.directory, "session.pending");
      if (existsSync(marker)) this.record("warn", "app.previous-unclean-exit");
      writeFileSync(marker, this.bootId);
    } catch { this.degraded = true; }
    this.startWriter();
    this.record("info", "app.started");
    this.timer = setInterval(() => this.pump(), 100); this.timer.unref();
  }
  private startWriter() {
    try {
      const worker = new Worker(this.writerPath, { workerData: { directory: this.directory, bootId: this.bootId } });
      this.worker = worker;
      worker.on("message", (value: { failed: boolean; bytes: number; files: number }) => {
        if (this.worker !== worker) return;
        const recovering = this.degraded && !value.failed;
        this.degraded = value.failed; this.bytes = value.bytes; this.files = value.files;
        if (value.failed) {
          this.fallback.push(...this.inFlight); this.trimFallback(); this.retryAt = Date.now() + 10_000;
          this.worker = undefined; void worker.terminate();
        } else if (this.fallback.length) {
          this.queue.unshift(...this.fallback); this.fallback = [];
          if (this.queue.length > 512) { this.dropped += this.queue.length - 512; this.queue.splice(0, this.queue.length - 512); }
        }
        this.inFlight = [];
        if (recovering) this.record("warn", "diagnostics.recovered", { count: this.dropped });
      });
      const disconnected = () => {
        if (this.worker !== worker) return;
        this.degraded = true; this.fallback.push(...this.inFlight); this.inFlight = []; this.trimFallback();
        this.worker = undefined; this.retryAt = Date.now() + 10_000;
      };
      worker.on("error", disconnected); worker.on("exit", disconnected); worker.unref();
    } catch { this.degraded = true; this.retryAt = Date.now() + 10_000; }
  }
  record(level: Level, event: string, context: DiagnosticContext = {}, error?: unknown, source = "main", processInstanceId: string = this.bootId, origin?: Source): string | undefined {
    if (level === "debug" && Date.now() >= this.debugUntil) return;
    if (!/^[a-z][a-z0-9.-]{0,79}$/.test(event)) return;
    const chain = error === undefined ? undefined : projectErrorChain(error);
    let incidentId: string | undefined;
    if (level === "error" || level === "fatal") {
      if (error && typeof error === "object") incidentId = this.incidents.get(error);
      if (incidentId) return incidentId;
      incidentId = randomUUID();
      const fingerprint = `${source}:${event}:${JSON.stringify(chain)}`;
      const repeat = this.repeats.get(fingerprint);
      if (repeat && Date.now() - repeat.last < 10_000) { repeat.count++; repeat.last = Date.now(); if (error && typeof error === "object") this.incidents.set(error, repeat.incidentId); return repeat.incidentId; }
      if (error && typeof error === "object") this.incidents.set(error, incidentId);
      if (this.repeats.size < 128) this.repeats.set(fingerprint, { count: 0, last: Date.now(), incidentId });
    }
    const now = new Date().toISOString();
    const line = JSON.stringify({ schemaVersion: 1, timestamp: origin?.timestamp && Number.isFinite(Date.parse(origin.timestamp)) ? new Date(origin.timestamp).toISOString() : now, observedTimestamp: now, level, event,
      component: event.split(".")[0], source, bootId: this.bootId, processInstanceId,
      sequence: ++this.sequence, sourceSequence: origin?.sourceSequence, appVersion: this.version, ...operationContext.getStore(), ...safeContext(context), incidentId, error: chain });
    if (Buffer.byteLength(line) > 8192) { this.dropped++; return incidentId; }
    if (this.queue.length >= 512) {
      const debug = this.queue.findIndex(item => item.includes('"level":"debug"'));
      if (debug >= 0) this.queue.splice(debug, 1); else this.queue.shift();
      this.dropped++;
    }
    this.queue.push(line);
    return incidentId;
  }
  private trimFallback() { if (this.fallback.length > 512) { this.dropped += this.fallback.length - 512; this.fallback.splice(0, this.fallback.length - 512); } }
  private pump() {
    for (const [key, repeat] of this.repeats) if (Date.now() - repeat.last >= 10_000) {
      this.repeats.delete(key);
      if (repeat.count) this.record("warn", "diagnostics.repeated", { operationId: repeat.incidentId, count: repeat.count });
    }
    if (Date.now() < this.retryAt) return;
    if (!this.worker && !this.closing) this.startWriter();
    if (this.degraded && !this.queue.length && this.fallback.length) this.queue.push(this.fallback[0]!);
    if (!this.worker || this.inFlight.length || !this.queue.length) return;
    this.inFlight = this.queue.splice(0, 32);
    try { this.worker.postMessage(this.inFlight); } catch { this.degraded = true; this.fallback.push(...this.inFlight); this.inFlight = []; this.trimFallback(); }
  }
  status(): DiagnosticStatus { return { degraded: this.degraded, dropped: this.dropped, debugUntil: Date.now() < this.debugUntil ? this.debugUntil : 0, queued: this.queue.length + this.inFlight.length + this.fallback.length, bytes: this.bytes, files: this.files }; }
  debug(enabled: boolean) { this.debugUntil = enabled ? Date.now() + 30 * 60_000 : 0; this.record("info", enabled ? "diagnostics.debug-enabled" : "diagnostics.debug-disabled"); return this.status(); }
  async flush(timeoutMs = 1500) {
    const deadline = Date.now() + timeoutMs;
    while ((this.queue.length || this.inFlight.length) && Date.now() < deadline) { this.pump(); await new Promise(resolve => setTimeout(resolve, 20)); }
    return !this.queue.length && !this.inFlight.length && !this.degraded;
  }
  async close(clean: boolean) {
    this.closing = true;
    for (const repeat of this.repeats.values()) if (repeat.count) this.record("warn", "diagnostics.repeated", { operationId: repeat.incidentId, count: repeat.count });
    this.repeats.clear();
    this.record("info", clean ? "app.stopped" : "app.fatal-exit", { count: this.dropped, outcome: clean ? "success" : "failed" });
    const flushed = await this.flush();
    if (clean && flushed) try { rmSync(join(this.directory, "session.pending"), { force: true }); } catch { /* Next start reports uncertain termination. */ }
    clearInterval(this.timer); await this.worker?.terminate();
  }
  memorySnapshot() { return [...this.fallback, ...this.inFlight, ...this.queue]; }
}
let active: Diagnostics | undefined;
export function initializeDiagnostics(directory: string, version: string) { active = new Diagnostics(directory, version); active.start(); return active; }
export function diagnostic(level: Level, event: string, context: DiagnosticContext = {}, error?: unknown, origin?: Source) { return active?.record(level, event, context, error, origin?.source, origin?.processInstanceId, origin); }
