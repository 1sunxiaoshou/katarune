import type { ToolCallMessagePartProps } from "@assistant-ui/react";

export function toolErrorMessage(result: unknown, status: ToolCallMessagePartProps["status"]): string | undefined {
  const value = result && typeof result === "object" && "error" in result ? result.error
    : status.type === "incomplete" ? status.error : undefined;
  return typeof value === "string" ? value : undefined;
}
