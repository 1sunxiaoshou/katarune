import { readResponseWithSizeLimit } from "@ai-sdk/provider-utils";
import type { ZodType } from "zod";
import { DEEPSEEK_API_ORIGIN } from "../../shared/providers";

type DeepSeekToolEndpoint = "search" | "fetch" | "ocr" | "asr" | "tts";

export function deepSeekToolPath(endpoint: DeepSeekToolEndpoint): string {
  return `/v1/tools/${endpoint}`;
}

export async function requestDeepSeekTool(
  endpoint: DeepSeekToolEndpoint,
  apiKey: string,
  body: FormData | object,
  maxBytes: number,
  timeoutMs: number,
  abortSignal?: AbortSignal,
): Promise<Uint8Array> {
  const url = new URL(deepSeekToolPath(endpoint), DEEPSEEK_API_ORIGIN);
  const timeout = AbortSignal.timeout(timeoutMs);
  const multipart = body instanceof FormData;
  const signal = abortSignal ? AbortSignal.any([abortSignal, timeout]) : timeout;
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, ...(!multipart ? { "Content-Type": "application/json" } : {}) },
      body: multipart ? body : JSON.stringify(body),
      redirect: "error",
      signal,
    });
  } catch {
    abortSignal?.throwIfAborted();
    throw new Error(`无法连接 DeepSeek ${endpoint} 服务。`);
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`DeepSeek ${endpoint} 请求失败（HTTP ${response.status}）。`);
  }
  if (endpoint === "tts" && response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "audio/pcm") {
    await response.body?.cancel().catch(() => undefined);
    throw new Error("DeepSeek 语音合成未返回 PCM 音频。");
  }
  try {
    const bytes = await readResponseWithSizeLimit({ response, url: url.href, maxBytes });
    signal.throwIfAborted();
    return bytes;
  } catch {
    abortSignal?.throwIfAborted();
    throw new Error(`无法完整读取 DeepSeek ${endpoint} 响应。`);
  }
}

export function parseDeepSeekToolResponse<T>(bytes: Uint8Array, schema: ZodType<T>): T {
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    const result = schema.safeParse(value);
    if (result.success) return result.data;
  } catch { /* Vendor payloads are not included in diagnostics. */ }
  throw new Error("DeepSeek 工具返回了无法识别的结果。");
}
