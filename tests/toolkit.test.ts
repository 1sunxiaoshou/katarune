import type { FrontendTools } from "@assistant-ui/react-ai-sdk";
import { describe, expect, it } from "vitest";
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
  it("merges trusted main tools with renderer-executed frontend tools", async () => {
    const tools = await kataruneAiToolkit.tools({ frontend: rendererTools });

    expect(Object.keys(tools)).toEqual(
      expect.arrayContaining(["get_current_time", "show_location"]),
    );
    expect(tools.get_current_time?.execute).toBeTypeOf("function");
    expect(tools.show_location?.execute).toBeUndefined();
  });

  it("rejects a frontend name collision with a trusted tool", async () => {
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
