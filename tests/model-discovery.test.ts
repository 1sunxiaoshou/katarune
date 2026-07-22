import { describe, expect, it, vi } from "vitest";

import { discoverProviderModels } from "../src/main/ai/modelDiscovery";
import type { ProviderConfig } from "../src/shared/ipc";

const now = new Date("2026-07-22T00:00:00.000Z");

function provider(overrides: Partial<ProviderConfig>): ProviderConfig {
  return {
    id: "d3867f4b-e85f-4ff4-ac2b-974dc39ad832",
    displayName: "Provider",
    providerType: "deepseek",
    baseUrl: null,
    credentialRef: "safe-storage/12345678-1234-4123-8123-123456789abc",
    settings: null,
    enabled: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("Provider model discovery", () => {
  it("reads an OpenAI-compatible model list without exposing the credential", async () => {
    const fetchImplementation = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe("https://api.deepseek.com/models");
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer secret-key");
      return Response.json({ data: [{ id: "deepseek-v4-pro", owned_by: "deepseek" }] });
    });

    await expect(discoverProviderModels(provider({}), "secret-key", fetchImplementation)).resolves.toEqual({
      models: [{ id: "deepseek-v4-pro", displayName: null, owner: "deepseek", description: null, modelType: null }],
    });
  });

  it("maps Google model capabilities and sends its key in a header", async () => {
    const fetchImplementation = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000");
      expect(new Headers(init?.headers).get("x-goog-api-key")).toBe("google-key");
      return Response.json({
        models: [
          { name: "models/gemini-test", baseModelId: "gemini-test", displayName: "Gemini Test", supportedGenerationMethods: ["generateContent"] },
          { name: "models/gemini-embed", supportedGenerationMethods: ["embedContent"] },
        ],
      });
    });

    const result = await discoverProviderModels(provider({ providerType: "google" }), "google-key", fetchImplementation);
    expect(result.models).toMatchObject([
      { id: "gemini-embed", modelType: "embeddingModel" },
      { id: "gemini-test", displayName: "Gemini Test", modelType: "languageModel" },
    ]);
  });

  it("uses the installed Gateway Provider discovery API and preserves model metadata", async () => {
    const fetchImplementation = vi.fn(async (input: string | URL | Request) => {
      expect(String(input)).toBe("https://ai-gateway.vercel.sh/v4/ai/config");
      return Response.json({
        models: [{
          id: "openai/test-model",
          name: "Test Model",
          description: "For tests",
          pricing: null,
          specification: { specificationVersion: "v4", provider: "openai", modelId: "test-model" },
          modelType: "language",
        }],
      });
    });

    await expect(discoverProviderModels(provider({ providerType: "gateway" }), "gateway-key", fetchImplementation)).resolves.toEqual({
      models: [{ id: "openai/test-model", displayName: "Test Model", owner: "openai", description: "For tests", modelType: "languageModel" }],
    });
  });

  it("returns a bounded error without including response content", async () => {
    const fetchImplementation = vi.fn(async () => new Response("secret vendor error", { status: 401 }));
    await expect(discoverProviderModels(provider({}), "bad-key", fetchImplementation)).rejects.toThrow("HTTP 401");
  });
});
