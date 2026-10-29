import * as z from "zod/mini";

export const DIAGNOSTICS_CHANNELS = {
  report: "diagnostics:report", status: "diagnostics:status",
  debug: "diagnostics:debug", open: "diagnostics:open", export: "diagnostics:export",
} as const;
export const safeErrorSchema = z.object({
  name: z.string().check(z.maxLength(64)),
  code: z.optional(z.string().check(z.maxLength(64))),
  httpStatus: z.optional(z.number().check(z.minimum(100), z.maximum(599))),
  retryable: z.optional(z.boolean()),
  frames: z.array(z.string().check(z.maxLength(160))).check(z.maxLength(12)),
  messageRedacted: z.literal(true),
});
export type SafeError = z.infer<typeof safeErrorSchema>;
export const rendererDiagnosticSchema = z.object({
  event: z.enum(["renderer.error", "renderer.rejection", "renderer.react-error", "renderer.resize-observer", "preload.error"]),
  // Raw errors never cross the renderer bridge. Main revalidates this projection.
  error: safeErrorSchema,
});
export type RendererDiagnostic = z.infer<typeof rendererDiagnosticSchema>;
export const diagnosticStatusSchema = z.object({
  degraded: z.boolean(), dropped: z.number(), debugUntil: z.number(),
  queued: z.number(), bytes: z.number(), files: z.number(),
});
export type DiagnosticStatus = z.infer<typeof diagnosticStatusSchema>;
export const rejectionCodeSchema = z.enum([
  "invalid-input", "forbidden-source", "resource-unavailable", "ownership-mismatch",
  "operation-not-allowed", "operation-in-progress", "configuration-required",
  "missing-port", "method-not-allowed", "unsupported-media", "rate-limited",
]);
export type RejectionCode = z.infer<typeof rejectionCodeSchema>;
export const PROCESS_EXIT_REASONS = ["clean-exit", "abnormal-exit", "killed", "crashed", "oom", "launch-failed", "integrity-failure", "memory-eviction"] as const;
const id = z.string().check(z.regex(/^[A-Za-z0-9_-]{1,100}$/));
export const diagnosticRecordSchema = z.object({
  schemaVersion: z.literal(1), timestamp: z.iso.datetime(), observedTimestamp: z.iso.datetime(),
  level: z.enum(["debug", "info", "warn", "error", "fatal"]), event: z.string().check(z.regex(/^[a-z][a-z0-9.-]{0,79}$/)),
  component: z.string().check(z.regex(/^[a-z][a-z0-9-]{0,39}$/)), source: z.enum(["main", "renderer", "unity", "asr"]),
  bootId: z.uuid(), processInstanceId: z.uuid(), sequence: z.number().check(z.int(), z.gte(0)),
  sourceSequence: z.optional(z.number().check(z.int(), z.gte(0))), appVersion: z.string().check(z.maxLength(64)),
  operationId: z.optional(id), parentOperationId: z.optional(id), runId: z.optional(id), dialogueId: z.optional(id),
  toolCallId: z.optional(id), performanceId: z.optional(id), incidentId: z.optional(z.uuid()),
  bindingEpoch: z.optional(z.number()), durationMs: z.optional(z.number()), attempt: z.optional(z.number()), exitCode: z.optional(z.number()), count: z.optional(z.number()),
  outcome: z.optional(z.enum(["success", "failed", "cancelled", "degraded", "spoken", "chat-only", "rejected"])),
  reasonCode: z.optional(rejectionCodeSchema),
  reason: z.optional(z.enum(PROCESS_EXIT_REASONS)), processKind: z.optional(z.enum(["renderer", "utility", "gpu", "other"])),
  error: z.optional(z.array(safeErrorSchema).check(z.maxLength(4))),
});
export const diagnosticExportSchema = z.object({ hours: z.union([z.literal(1), z.literal(24), z.literal(168)]) });
export const diagnosticActionSchema = z.object({ status: z.enum(["success", "cancelled", "error"]) });
export interface DiagnosticsApi {
  reportDiagnostic(event: RendererDiagnostic): void;
  getDiagnosticsStatus(): Promise<DiagnosticStatus>;
  setDiagnosticsDebug(enabled: boolean): Promise<DiagnosticStatus>;
  openDiagnostics(): Promise<z.infer<typeof diagnosticActionSchema>>;
  exportDiagnostics(request: z.infer<typeof diagnosticExportSchema>): Promise<z.infer<typeof diagnosticActionSchema>>;
}

const names = new Set(["ZodError", "SqliteError", "AI_InvalidToolInputError", "AI_NoSuchToolError", "AI_ToolExecutionError", "AI_NoOutputGeneratedError", "Error", "TypeError", "RangeError", "SyntaxError", "ReferenceError", "AbortError", "TimeoutError", "SpeechServiceError", "AI_APICallError", "AI_RetryError", "AI_NoSpeechGeneratedError", "AI_LoadAPIKeyError", "AI_InvalidResponseDataError", "AI_NoSuchModelError", "IOException", "InvalidOperationException", "NullReferenceException", "ArgumentException"]);
const codes = new Set(["ECONNRESET", "ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT", "EACCES", "EPERM", "ENOSPC", "ENOENT", "EPIPE", "ENOMEM", "MODULE_NOT_FOUND", "SQLITE_BUSY", "SQLITE_CORRUPT", "SQLITE_FULL", "ERR_ABORTED", "ERR_NETWORK", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_SOCKET", "not-configured", "model-unavailable", "provider-error", "speech-unavailable", "speech-empty", "speech-failed", "speech-timeout", "speech-auth", "speech-rate-limit"]);
function get(value: unknown, key: string): unknown {
  try { return value !== null && typeof value === "object" ? Reflect.get(value, key) : undefined; } catch { return undefined; }
}
/** Keep locations, never the first stack line, function arguments, URLs or user paths. */
export function safeFrames(stack: unknown): string[] {
  if (typeof stack !== "string") return [];
  return stack.slice(0, 16384).split("\n").slice(1, 25).flatMap(line => {
    const match = line.replaceAll("\\", "/").match(/(?:^|[/ (])((?:src|out|resources|Assets\/Katarune|node_modules)\/[A-Za-z0-9_@./-]+\.(?:[cm]?js|tsx?|cs)):(\d+)(?::(\d+))?/);
    if (!match || match[1]!.includes("..")) return [];
    return [`${match[1]}:${match[2]}${match[3] ? `:${match[3]}` : ""}`.slice(0, 160)];
  }).slice(0, 12);
}
export function projectError(error: unknown): SafeError {
  const name = get(error, "name"), code = get(error, "code"), httpStatus = get(error, "statusCode"), retryable = get(error, "isRetryable");
  return { name: typeof name === "string" && names.has(name) ? name : "Error",
    ...(typeof code === "string" && codes.has(code) ? { code } : {}),
    ...(typeof httpStatus === "number" && Number.isInteger(httpStatus) && httpStatus >= 100 && httpStatus <= 599 ? { httpStatus } : {}),
    ...(typeof retryable === "boolean" ? { retryable } : {}),
    frames: safeFrames(get(error, "stack")), messageRedacted: true };
}
export function projectErrorChain(error: unknown): SafeError[] {
  const result: SafeError[] = [], visited = new Set<unknown>();
  while (error != null && result.length < 4 && !visited.has(error)) {
    visited.add(error); result.push(projectError(error));
    error = get(error, "cause") ?? get(error, "lastError");
  }
  return result;
}
