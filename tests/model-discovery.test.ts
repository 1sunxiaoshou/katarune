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
  it("discovers the Fish Audio TTS backends without treating voices as models", async () => {
    const fetchImplementation = vi.fn();
    const result = await discoverProviderModels(
      provider({ providerType: "fish-audio" }),
      "fish-key",
      fetchImplementation,
    );

    expect(result).toMatchObject({
      source: "provider",
      warning: null,
      models: [
        { id: "s2.1-pro-free", modelType: "speechModel" },
        { id: "s2.1-pro", modelType: "speechModel" },
        { id: "s2-pro", modelType: "speechModel" },
        { id: "s1", modelType: "speechModel" },
      ],
    });
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it("reads an OpenAI-compatible model list without exposing the credential", async () => {
    const fetchImplementation = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe("https://api.deepseek.com/models");
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer secret-key");
      return Response.json({ data: [{ id: "deepseek-v4-pro", owned_by: "deepseek" }] });
    });

    const result = await discoverProviderModels(provider({}), "secret-key", fetchImplementation);
    expect(result).toMatchObject({
      source: "provider",
      warning: null,
      models: [{
        id: "deepseek-v4-pro",
        modelType: "languageModel",
        typeSource: "litellm-snapshot",
      }],
    });
  });

  it("uses a preset provider identity to enrich models returned by a custom Base URL", async () => {
    const fetchImplementation = vi.fn(async (input: string | URL | Request) => {
      expect(String(input)).toBe("https://deepseek-proxy.example/v1/models");
      return Response.json({ data: [{ id: "deepseek-v4-pro" }] });
    });

    const result = await discoverProviderModels(provider({
      baseUrl: "https://deepseek-proxy.example/v1",
    }), "key", fetchImplementation);
    expect(result.models[0]).toMatchObject({
      id: "deepseek-v4-pro",
      modelType: "languageModel",
      typeSource: "litellm-snapshot",
    });
  });

  it("prefers a recognized custom Base URL identity over the selected preset provider", async () => {
    const fetchImplementation = vi.fn(async (input: string | URL | Request) => {
      expect(String(input)).toBe("https://api.deepseek.com/models");
      return Response.json({ data: [{ id: "deepseek-v4-pro" }] });
    });

    const result = await discoverProviderModels(provider({
      providerType: "openai",
      baseUrl: "https://api.deepseek.com/",
    }), "key", fetchImplementation);
    expect(result.models[0]).toMatchObject({
      id: "deepseek-v4-pro",
      modelType: "languageModel",
      typeSource: "litellm-snapshot",
    });
  });

  it("falls back from a recognized custom Base URL identity to the selected preset provider", async () => {
    const fetchImplementation = vi.fn(async (input: string | URL | Request) => {
      expect(String(input)).toBe("https://api.openai.com/v1/models");
      return Response.json({ data: [{ id: "deepseek-v4-pro" }] });
    });

    const result = await discoverProviderModels(provider({
      baseUrl: "https://api.openai.com/v1",
    }), "key", fetchImplementation);
    expect(result.models[0]).toMatchObject({
      id: "deepseek-v4-pro",
      modelType: "languageModel",
      typeSource: "litellm-snapshot",
    });
  });

  it("uses a recognized Base URL identity for OpenAI-compatible providers", async () => {
    const fetchImplementation = vi.fn(async () =>
      Response.json({ data: [{ id: "deepseek-v4-pro" }] }));

    const result = await discoverProviderModels(provider({
      providerType: "openai-compatible",
      baseUrl: "https://api.deepseek.com",
    }), "key", fetchImplementation);
    expect(result.models[0]).toMatchObject({
      id: "deepseek-v4-pro",
      modelType: "languageModel",
      typeSource: "litellm-snapshot",
    });
  });

  it("uses the online LiteLLM catalog when the bundled snapshot has no matching model", async () => {
    const fetchImplementation = vi.fn(async (input: string | URL | Request) => {
      if (String(input).includes("raw.githubusercontent.com/BerriAI/litellm")) {
        return Response.json({
          "brand-new-gemini": {
            litellm_provider: "gemini",
            mode: "embedding",
            supported_endpoints: ["/v1/embeddings"],
            max_input_tokens: 32000,
          },
        });
      }
      return Response.json({ models: [{ name: "models/brand-new-gemini" }] });
    });
    const result = await discoverProviderModels(provider({
      providerType: "google",
    }), "key", fetchImplementation);
    expect(result.models[0]).toMatchObject({
      id: "brand-new-gemini",
      modelType: "embeddingModel",
      typeSource: "litellm-api",
    });
  });

  it("uses LiteLLM types instead of Google method declarations", async () => {
    const fetchImplementation = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("x-goog-api-key")).toBe("google-key");
      if (String(input).includes("pageToken=next-google-page")) {
        return Response.json({
          models: [
            { name: "models/text-embedding-004", supportedGenerationMethods: ["generateContent"] },
          ],
        });
      }
      expect(String(input)).toBe("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000");
      return Response.json({
        models: [
          { name: "models/gemini-2.5-pro", baseModelId: "gemini-2.5-pro", displayName: "Gemini 2.5 Pro", supportedGenerationMethods: ["embedContent"] },
        ],
        nextPageToken: "next-google-page",
      });
    });

    const result = await discoverProviderModels(provider({ providerType: "google" }), "google-key", fetchImplementation);
    expect(result.models).toMatchObject([
      {
        id: "gemini-2.5-pro",
        modelType: "languageModel",
        typeSource: "litellm-snapshot",
      },
      {
        id: "text-embedding-004",
        modelType: "embeddingModel",
        typeSource: "litellm-snapshot",
      },
    ]);
    expect(fetchImplementation).toHaveBeenCalledTimes(2);
  });

  it("keeps Anthropic pagination and authentication inside its definition", async () => {
    const fetchImplementation = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("x-api-key")).toBe("anthropic-key");
      if (String(input).includes("after_id=page-one")) {
        return Response.json({
          data: [{ id: "page-two" }],
          has_more: false,
          last_id: "page-two",
        });
      }
      expect(String(input)).toBe("https://api.anthropic.com/v1/models?limit=1000");
      return Response.json({
        data: [{ id: "page-one" }],
        has_more: true,
        last_id: "page-one",
      });
    });

    const result = await discoverProviderModels(
      provider({ providerType: "anthropic" }),
      "anthropic-key",
      fetchImplementation,
    );
    expect(result.models.map((model) => model.id)).toEqual([
      "page-one",
      "page-two",
    ]);
    expect(fetchImplementation).toHaveBeenCalledTimes(2);
  });

  it("uses the installed Gateway Provider discovery API and its model type", async () => {
    const fetchImplementation = vi.fn(async (input: string | URL | Request) => {
      expect(String(input)).toBe("https://ai-gateway.vercel.sh/v4/ai/config");
      return Response.json({
        models: [{
          id: "openai/gpt-4o",
          name: "Test Model",
          description: "For tests",
          pricing: null,
          specification: { specificationVersion: "v4", provider: "openai", modelId: "gpt-4o" },
          modelType: "embedding",
        }],
      });
    });

    await expect(discoverProviderModels(provider({ providerType: "gateway" }), "gateway-key", fetchImplementation)).resolves.toMatchObject({
      source: "provider",
      warning: null,
      models: [{
        id: "openai/gpt-4o",
        displayName: "Test Model",
        modelType: "embeddingModel",
        typeSource: "gateway",
      }],
    });
  });

  it("does not use provider endpoint metadata as the final model type", async () => {
    const fetchImplementation = vi.fn(async () => Response.json({
      data: [{
        id: "multi-purpose",
        supported_endpoint_types: ["chat.completions", "embeddings"],
      }],
    }));
    const result = await discoverProviderModels(provider({
      providerType: "openai-compatible",
      baseUrl: "https://unknown.example/v1",
    }), "key", fetchImplementation);
    expect(result.models[0]).toMatchObject({
      modelType: null,
      typeSource: null,
    });
  });

  it("resolves a model type without knowing the upstream provider when LiteLLM entries agree", async () => {
    const fetchImplementation = vi.fn(async () => Response.json({ data: [{ id: "gpt-4o" }] }));
    const result = await discoverProviderModels(provider({
      providerType: "openai-compatible",
      baseUrl: "https://unknown.example/v1",
    }), "key", fetchImplementation);
    expect(result.models[0]).toMatchObject({
      id: "gpt-4o",
      modelType: "languageModel",
      typeSource: "litellm-snapshot",
    });
  });

  it("falls back to the bundled catalog when the provider endpoint is unsupported", async () => {
    const fetchImplementation = vi.fn(async () => new Response(null, { status: 404 }));
    const result = await discoverProviderModels(provider({}), "key", fetchImplementation);
    expect(result.source).toBe("litellm-snapshot");
    expect(result.warning).toContain("HTTP 404");
    expect(result.models.some((model) => model.id === "deepseek-v4-pro")).toBe(true);
    expect(result.models.every((model) => model.modelType === "languageModel")).toBe(true);
  });

  it("does not replace a custom Base URL inventory with the preset provider catalog", async () => {
    const fetchImplementation = vi.fn(async () => new Response(null, { status: 404 }));
    await expect(discoverProviderModels(provider({
      baseUrl: "https://deepseek-proxy.example/v1",
    }), "key", fetchImplementation)).rejects.toThrow(
      "自定义 Base URL 的实际可用模型不能由供应商完整目录代替",
    );
  });

  it("does not replace the live Gateway inventory with a static catalog on transient failure", async () => {
    const fetchImplementation = vi.fn(async () => new Response("temporary", { status: 500 }));
    await expect(
      discoverProviderModels(provider({ providerType: "gateway" }), "key", fetchImplementation),
    ).rejects.toThrow("无法确认当前可用模型");
  });

  it("returns a bounded error without including response content", async () => {
    const fetchImplementation = vi.fn(async () => new Response("secret vendor error", { status: 401 }));
    await expect(discoverProviderModels(provider({}), "bad-key", fetchImplementation)).rejects.toThrow("HTTP 401");
  });
});
