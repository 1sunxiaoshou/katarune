import { describe, expect, it } from "vitest";
import { PROVIDER_TYPES, type ModelConfig, type ProviderConfig } from "../src/shared/ipc";
import { createConfiguredProvider } from "../src/main/ai/providerFactory";
import { createAiRuntime, type AiRuntimeDatabase } from "../src/main/ai/runtime";
import type { CredentialStore } from "../src/main/security/credentialStore";

const providerConfigId = "d3867f4b-e85f-4ff4-ac2b-974dc39ad832";
const modelConfigId = "e76076e7-73a8-42c2-92d7-f9fa8d44f5eb";
const now = new Date("2026-07-19T00:00:00.000Z");

function providerConfig(
  providerType: ProviderConfig["providerType"],
  overrides: Partial<ProviderConfig> = {},
): ProviderConfig {
  return {
    id: providerConfigId,
    displayName: providerType,
    providerType,
    baseUrl: providerType === "openai-compatible" ? "http://127.0.0.1:1234/v1" : null,
    credentialRef: providerType === "openai-compatible" ? null : "safe-storage/test",
    settings: null,
    enabled: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

const modelConfig: ModelConfig = {
  id: modelConfigId,
  providerConfigId,
  modelType: "languageModel",
  modelId: "test-model",
  displayName: "Test model",
  settings: { temperature: 0.2, maxOutputTokens: 128 },
  enabled: true,
  createdAt: now,
  updatedAt: now,
};

function runtimeDatabase(provider: ProviderConfig): AiRuntimeDatabase {
  return {
    listProviderConfigs: () => ({ providerConfigs: [provider] }),
    listModelConfigs: () => ({ modelConfigs: [modelConfig] }),
    fetchProviderConfig: (id) => {
      if (id !== provider.id) throw new Error("Provider not found.");
      return provider;
    },
    fetchModelConfig: (id) => {
      if (id !== modelConfig.id) throw new Error("Model not found.");
      return modelConfig;
    },
  };
}

const credentialStore: CredentialStore = {
  put: async () => "safe-storage/test",
  resolve: async () => "test-api-key",
  delete: async () => undefined,
};

describe("configured Provider runtime", () => {
  it.each(PROVIDER_TYPES)("constructs the official %s Provider factory", (providerType) => {
    const provider = createConfiguredProvider(providerConfig(providerType), "test-api-key");
    expect(provider.specificationVersion).toMatch(/^v[34]$/);
  });

  it("requires a base URL for OpenAI-compatible Providers", () => {
    expect(() =>
      createConfiguredProvider(
        providerConfig("openai-compatible", { baseUrl: null }),
        "test-api-key",
      ),
    ).toThrow(/base URL/);
  });

  it("builds a callable registry and probes a stored model without exposing credentials", async () => {
    let probeCount = 0;
    const runtime = await createAiRuntime({
      database: runtimeDatabase(providerConfig("openai-compatible")),
      credentialStore,
      connectionProbe: async () => {
        probeCount += 1;
      },
    });

    expect(runtime.getStatus()).toMatchObject({
      configuredProviderCount: 1,
      modelCallsEnabled: true,
    });
    expect(runtime.resolveLanguageModel(modelConfigId)).toMatchObject({ modelId: "test-model" });
    await expect(runtime.testConnection(modelConfigId)).resolves.toMatchObject({ success: true });
    expect(probeCount).toBe(1);
  });

  it("does not register direct Providers without a credential reference", async () => {
    const runtime = await createAiRuntime({
      database: runtimeDatabase(providerConfig("openai", { credentialRef: null })),
      credentialStore,
    });

    expect(runtime.getStatus()).toMatchObject({
      configuredProviderCount: 0,
      modelCallsEnabled: false,
    });
  });

  it("does not resolve a non-language model as a language model", async () => {
    const provider = providerConfig("openai-compatible");
    const embeddingConfig: ModelConfig = { ...modelConfig, modelType: "embeddingModel" };
    const database = runtimeDatabase(provider);
    const runtime = await createAiRuntime({
      database: {
        ...database,
        listModelConfigs: () => ({ modelConfigs: [embeddingConfig] }),
        fetchModelConfig: () => embeddingConfig,
      },
      credentialStore,
    });

    expect(runtime.getStatus().modelCallsEnabled).toBe(false);
    expect(() => runtime.resolveLanguageModel(modelConfigId)).toThrow(/embeddingModel/);
  });
});
