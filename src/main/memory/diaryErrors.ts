import { APICallError, NoOutputGeneratedError, InvalidToolInputError } from "ai";
import { ZodError } from "zod";
import type { DiaryFailureCode } from "../../shared/memory";

export class DiaryError extends Error {
  constructor(readonly code: DiaryFailureCode) { super(code); }
}

// Persist controlled categories only: provider errors can contain private request data.
export function diaryFailureCode(error: unknown): DiaryFailureCode {
  if (error instanceof DiaryError) return error.code;
  if (error instanceof ZodError || NoOutputGeneratedError.isInstance(error) || InvalidToolInputError.isInstance(error)) return "invalid_output";
  if (error instanceof Error && error.name === "TimeoutError") return "timeout";
  if (error instanceof Error && error.name === "AbortError") return "interrupted";
  if (APICallError.isInstance(error)) {
    const status = error.statusCode;
    if (status === 401 || status === 403) return "authentication";
    if (status === 429) return "rate_limit";
    if (status === 408 || status === 504) return "timeout";
    if (status !== undefined && status >= 500) return "provider";
    return status === undefined ? "network" : "request_rejected";
  }
  return "unknown";
}
