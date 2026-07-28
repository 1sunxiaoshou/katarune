import type { FrontendTools } from "@assistant-ui/react-ai-sdk";
import { describe, expect, it, vi } from "vitest";
import {
  kataruneAiToolkit,
  type ProviderToolContext,
} from "../src/main/ai/toolkit";

const rendererTools: FrontendTools = {
  show_location: {
    description: "Show a location in the renderer.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string" },
      },
      required: ["name"],
      additionalProperties: false,
    },
  },
};

describe("Katarune AI toolkit", () => {
  it("merges the trusted time tool with renderer-executed frontend tools", async () => {
    const tools = await kataruneAiToolkit.tools({ frontend: rendererTools });

    expect(Object.keys(tools)).toEqual(
      expect.arrayContaining(["get_current_time", "show_location"]),
    );
    expect(tools.get_current_time?.execute).toBeTypeOf("function");
    expect(tools.show_location?.execute).toBeUndefined();
  });

  it("returns the exact current local time with its UTC offset and IANA time zone", async () => {
    vi.useFakeTimers();
    try {
      const now = new Date("2026-07-28T07:32:18.000Z");
      vi.setSystemTime(now);
      const tools = await kataruneAiToolkit.tools();
      const execute = tools.get_current_time?.execute;

      expect(execute).toBeTypeOf("function");
      if (execute === undefined) throw new Error("Time tool is not executable.");

      const result = await execute(
        {},
        {
          toolCallId: "time-call",
          messages: [],
          context: undefined,
        },
      );

      expect(result).toEqual({
        localDateTime: expect.stringMatching(
          /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/,
        ),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      if (
        typeof result !== "object" ||
        result === null ||
        !("localDateTime" in result) ||
        typeof result.localDateTime !== "string"
      ) {
        throw new Error("Time tool returned an invalid result.");
      }
      expect(Date.parse(result.localDateTime)).toBe(now.getTime());
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects a frontend name collision with the trusted time tool", async () => {
    await expect(
      kataruneAiToolkit.tools({
        frontend: {
          ...rendererTools,
          get_current_time: {
            description: "Untrusted replacement.",
            parameters: { type: "object", properties: {} },
          },
        },
      }),
    ).rejects.toThrow(
      'Frontend tool "get_current_time" conflicts with a trusted tool.',
    );
  });

  it.each<{
    context: ProviderToolContext;
    expected: Record<string, string>;
  }>([
    {
      context: { provider: "openai.responses", modelId: "gpt-5" },
      expected: { web_search: "openai.web_search" },
    },
    {
      context: {
        provider: "anthropic.messages",
        modelId: "claude-sonnet-4-20250514",
      },
      expected: {
        web_search: "anthropic.web_search_20250305",
        web_fetch: "anthropic.web_fetch_20250910",
      },
    },
    {
      context: {
        provider: "google.generative-ai",
        modelId: "gemini-2.5-pro",
      },
      expected: {
        google_search: "google.google_search",
        url_context: "google.url_context",
      },
    },
    {
      context: { provider: "xai.responses", modelId: "grok-4" },
      expected: { web_search: "xai.web_search" },
    },
    {
      context: { provider: "gateway", modelId: "openai/gpt-5" },
      expected: { web_search: "openai.web_search" },
    },
  ])("adds native web tools for $context.provider", async ({ context, expected }) => {
    const tools = await kataruneAiToolkit.tools({
      providerContext: context,
    });

    for (const [name, id] of Object.entries(expected)) {
      expect(tools[name]).toMatchObject({ type: "provider", id });
    }
  });

  it("does not pretend unsupported Providers have native web tools", async () => {
    const tools = await kataruneAiToolkit.tools({
      providerContext: {
        provider: "deepseek.chat",
        modelId: "deepseek-chat",
      },
    });

    expect(tools).toHaveProperty("get_current_time");
    expect(tools).not.toHaveProperty("web_search");
    expect(tools).not.toHaveProperty("web_fetch");
    expect(tools).not.toHaveProperty("google_search");
    expect(tools).not.toHaveProperty("url_context");
  });

  it("rejects a frontend collision with a native Provider tool", async () => {
    await expect(
      kataruneAiToolkit.tools({
        providerContext: {
          provider: "openai.responses",
          modelId: "gpt-5",
        },
        frontend: {
          web_search: {
            description: "Untrusted replacement.",
            parameters: { type: "object", properties: {} },
          },
        },
      }),
    ).rejects.toThrow(
      'Frontend tool "web_search" conflicts with a trusted tool.',
    );
  });
});
