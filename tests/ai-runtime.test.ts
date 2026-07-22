import {
  ToolLoopAgent,
  createProviderRegistry,
  customProvider,
  simulateReadableStream,
} from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";

describe("AI SDK runtime baseline", () => {
  it("streams deterministic text through the registry and agent", async () => {
    const model = new MockLanguageModelV4({
      doStream: async () => ({
        stream: simulateReadableStream({
          chunks: [
            { type: "text-start", id: "text-1" },
            { type: "text-delta", id: "text-1", delta: "Katarune" },
            { type: "text-delta", id: "text-1", delta: " ready" },
            { type: "text-end", id: "text-1" },
            {
              type: "finish",
              finishReason: { unified: "stop", raw: undefined },
              logprobs: undefined,
              usage: {
                inputTokens: {
                  total: 2,
                  noCache: 2,
                  cacheRead: undefined,
                  cacheWrite: undefined,
                },
                outputTokens: {
                  total: 2,
                  text: 2,
                  reasoning: undefined,
                },
              },
            },
          ],
        }),
      }),
    });
    const registry = createProviderRegistry({
      validation: customProvider({
        languageModels: { deterministic: model },
      }),
    });
    const agent = new ToolLoopAgent({
      id: "katarune-p1-validation",
      model: registry.languageModel("validation:deterministic"),
      instructions: "Return the deterministic validation response.",
    });

    const result = await agent.stream({ prompt: "Validate the runtime." });
    let text = "";

    for await (const delta of result.textStream) {
      text += delta;
    }

    expect(text).toBe("Katarune ready");
  });
});
