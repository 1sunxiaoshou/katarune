import { createDeepSeek } from "@ai-sdk/deepseek";
import { APICallError, defaultSettingsMiddleware, wrapLanguageModel } from "ai";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { generateDiary, diaryInstructions } from "../src/main/memory/diaryService";
import { DiaryError, diaryFailureCode } from "../src/main/memory/diaryErrors";

const draft = { worthKeeping: true, title: "练习", body: "今天听到练琴的打算，我想下次再问问进展。" };
const input = { prompt: "合成对话：计划练琴。", instructions: diaryInstructions, signal: new AbortController().signal, tools: {} };

describe("diary submission over the locked DeepSeek adapter", () => {
  it("submits a validated draft without JSON response format or forced tool choice, preserving thinking", async () => {
    const requests: unknown[] = [];
    const warnings = vi.fn();
    vi.stubGlobal("AI_SDK_LOG_WARNINGS", warnings);
    try {
      const provider = createDeepSeek({ apiKey: "fixture-key", fetch: async (_url, init) => {
        requests.push(JSON.parse(String(init?.body)));
        return Response.json({ id: "fixture", created: 1, model: "deepseek-flash", choices: [{ index: 0, finish_reason: "tool_calls", message: {
          role: "assistant", content: null, reasoning_content: "合成推理。",
          tool_calls: [{ id: "finish", type: "function", function: { name: "finish_diary", arguments: JSON.stringify(draft) } }],
        } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
      } });
      const model = wrapLanguageModel({ model: provider("deepseek-flash"), middleware: defaultSettingsMiddleware({ settings: { providerOptions: { deepseek: { thinking: { type: "enabled" } } } } }) });
      expect(await generateDiary({ ...input, model })).toEqual(draft);
      expect(requests).toHaveLength(1);
      const request = z.object({ thinking: z.object({ type: z.literal("enabled") }), tool_choice: z.literal("auto").optional(), tools: z.array(z.object({ function: z.object({ name: z.string() }) })) }).parse(requests[0]);
      expect(request.tools.map(tool => tool.function.name)).toEqual(["finish_diary"]);
      expect(requests[0]).not.toHaveProperty("response_format");
      expect(warnings).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });

  it.each([
    { content: "普通文字，不是工具提交。", finish_reason: "stop", tool_calls: undefined },
    { content: null, finish_reason: "tool_calls", tool_calls: [{ id: "bad", type: "function", function: { name: "finish_diary", arguments: JSON.stringify({ worthKeeping: true, title: "", body: "" }) } }] },
    { content: null, finish_reason: "length", tool_calls: [{ id: "cut", type: "function", function: { name: "finish_diary", arguments: '{"worthKeeping":true,' } }] },
  ])("rejects missing, invalid or truncated submissions instead of saving a diary", async message => {
    const provider = createDeepSeek({ apiKey: "fixture-key", fetch: async () => Response.json({ choices: [{ index: 0, finish_reason: message.finish_reason, message: { role: "assistant", ...message } }] }) });
    await expect(generateDiary({ ...input, model: provider("deepseek-flash") })).rejects.toMatchObject({ code: "invalid_output" });
  });
});

it.each([[401, "authentication"], [403, "authentication"], [429, "rate_limit"], [503, "provider"], [504, "timeout"], [400, "request_rejected"], [undefined, "network"]] as const)("classifies status %s without exposing raw provider data", (statusCode, expected) => {
  expect(diaryFailureCode(new APICallError({ message: "private fixture detail", url: "https://example.invalid", requestBodyValues: { private: "fixture" }, responseBody: "private fixture response", ...(statusCode === undefined ? {} : { statusCode }) }))).toBe(expected);
});

it("distinguishes timeouts, interruptions and validated service errors", () => {
  expect(diaryFailureCode(new DOMException("fixture", "TimeoutError"))).toBe("timeout");
  expect(diaryFailureCode(new DOMException("fixture", "AbortError"))).toBe("interrupted");
  expect(diaryFailureCode(new DiaryError("configuration"))).toBe("configuration");
  expect(diaryFailureCode(new Error("private fixture detail"))).toBe("unknown");
});
