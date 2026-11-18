import type { SpeechResult } from "ai";
import { describe, expect, it, vi } from "vitest";
import { PROVIDER_TYPES, type ModelConfig, type ProviderConfig } from "../src/shared/ipc";
import { createConfiguredProvider } from "../src/main/ai/providerFactory";
import {
  PROVIDER_DEFINITIONS,
  validateModelMetadata,
  validateModelSettings,
  validateProviderSettings,
} from "../src/main/ai/providerDefinitions";
import { createAiRuntime, type AiRuntimeDatabase } from "../src/main/ai/runtime";
import {
  getProviderCredentialRequirement,
  providerCredentialIsAvailable,
} from "../src/shared/providers";
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
  metadata: null,
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
  it("exposes DeepSeek Search only for an enabled official connection with credentials", async () => {
    const config = { ...providerConfig("deepseek") };
    const runtime = await createAiRuntime({ database: runtimeDatabase(config), credentialStore });
    expect(Object.keys(runtime.createProviderChatTools({}).tools)).toEqual(["deepseek_search", "deepseek_fetch"]);
    expect(runtime.listProviderTools(config.id).map(tool => [tool.id, tool.name, tool.apiPath])).toEqual([
      ["deepseek_search", "网页搜索", "/v1/tools/search"],
      ["deepseek_fetch", "网页抓取", "/v1/tools/fetch"],
      ["deepseek_ocr", "OCR", "/v1/tools/ocr"],
      ["deepseek_asr", "语音识别", "/v1/tools/asr"],
      ["deepseek_tts", "语音合成", "/v1/tools/tts"],
    ]);
    config.settings = { webFetchEnabled: false };
    await runtime.reload();
    expect(Object.keys(runtime.createProviderChatTools({}).tools)).toEqual(["deepseek_search"]);
    config.settings = null;
    await runtime.reload();
    const tools = runtime.createProviderChatTools({
      readCurrentAttachment: () => { throw new Error("Fixture tool should not run in this test"); },
      writeSpeechFile: async () => "outputs/fixture.wav",
    });
    expect(Object.keys(tools.tools)).toEqual(["deepseek_search", "deepseek_fetch", "deepseek_ocr", "deepseek_asr", "deepseek_tts"]);
    expect(runtime.listProviderTools(config.id, "live").map(tool => tool.id)).toEqual(["deepseek_search", "deepseek_fetch"]);
    expect(Object.keys(runtime.createProviderChatTools({}, "live").tools)).toEqual(["deepseek_search", "deepseek_fetch"]);
    expect(tools.attachmentTool("scan.pdf")).toBe("deepseek_ocr");
    expect(tools.attachmentTool("recording.wav")).toBe("deepseek_asr");
    expect(tools.attachmentTool("table.csv")).toBeUndefined();
    config.baseUrl = "https://gateway.example.invalid";
    await runtime.reload();
    expect(runtime.createProviderChatTools({}).tools).toEqual({});
    expect(runtime.listProviderTools(config.id)).toEqual([]);
    config.baseUrl = null;
    const unavailable = await createAiRuntime({
      database: runtimeDatabase(config),
      credentialStore: { ...credentialStore, resolve: vi.fn().mockRejectedValue(new Error("Fixture key unavailable")) },
    });
    expect(unavailable.createProviderChatTools({}).tools).toEqual({});
  });

  it("keeps credential requirements and main definitions exhaustive", () => {
    expect(Object.keys(PROVIDER_DEFINITIONS).sort()).toEqual(
      [...PROVIDER_TYPES].sort(),
    );
    expect(getProviderCredentialRequirement("openai").credentialMode).toBe(
      "required",
    );
    expect(PROVIDER_DEFINITIONS.openai.speechModel).toBeDefined();
    expect(PROVIDER_DEFINITIONS.google.speechModel).toBeDefined();
    expect(PROVIDER_DEFINITIONS["fish-audio"].speechModel).toBeDefined();
    expect(PROVIDER_DEFINITIONS.anthropic.speechModel).toBeUndefined();
    expect(providerCredentialIsAvailable("openai", null)).toBe(false);
    expect(providerCredentialIsAvailable("openai-compatible", null)).toBe(true);
  });

  it("normalizes Google speech output and requires a valid RIFF/WAVE payload", () => {
    const capability = PROVIDER_DEFINITIONS.google.speechModel;
    expect(capability).toBeDefined();
    if (capability === undefined) return;
    const wav = new Uint8Array(44);
    wav.set(new TextEncoder().encode("RIFF"), 0);
    wav.set(new TextEncoder().encode("WAVE"), 8);
    const normalized = capability.normalizeAudio({
      uint8Array: wav,
      format: "wav",
      mediaType: "audio/wav",
    } as SpeechResult["audio"]);

    expect(normalized).toMatchObject({
      format: "wav",
      mediaType: "audio/wav",
    });
    expect(capability.validateAudio(normalized.audio)).toBe(true);
    expect(capability.validateAudio(new Uint8Array(44))).toBe(false);
  });

  it("delegates bounded settings to Provider and capability schemas", () => {
    expect(() =>
      validateProviderSettings("openai-compatible", {
        supportsStructuredOutputs: true,
      }),
    ).not.toThrow();
    expect(() =>
      validateProviderSettings("openai-compatible", {
        apiKey: "must-not-be-persisted",
      }),
    ).toThrow();
    expect(() =>
      validateModelSettings("openai", "languageModel", {
        temperature: 0.2,
        topP: 0.9,
      }),
    ).not.toThrow();
    expect(() =>
      validateModelSettings("openai", "languageModel", { topP: 2 }),
    ).toThrow();
    expect(() =>
      validateModelSettings("openai", "speechModel", {
        temperature: 0.2,
      }),
    ).toThrow();
    expect(() =>
      validateModelSettings("anthropic", "speechModel", {
        defaultVoiceId: null,
      }),
    ).not.toThrow();
    expect(() =>
      validateModelMetadata("openai", "speechModel", {
        voices: [{ id: "alloy", displayName: "Alloy" }],
      }),
    ).not.toThrow();
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

  it("keeps persisted invalid settings unavailable without rewriting records", async () => {
    const provider = providerConfig("openai", {
      settings: { unknownProviderOption: true },
    });
    const database = runtimeDatabase(provider);
    const runtime = await createAiRuntime({
      database,
      credentialStore,
    });

    expect(runtime.getStatus()).toMatchObject({
      configuredProviderCount: 0,
      modelCallsEnabled: false,
    });
    expect(database.fetchProviderConfig(provider.id).settings).toEqual({
      unknownProviderOption: true,
    });
  });

  it("rejects invalid persisted model settings at resolution time", async () => {
    const provider = providerConfig("openai-compatible");
    const invalidModel = {
      ...modelConfig,
      settings: { topP: 2 },
    } satisfies ModelConfig;
    const baseDatabase = runtimeDatabase(provider);
    const runtime = await createAiRuntime({
      database: {
        ...baseDatabase,
        listModelConfigs: () => ({ modelConfigs: [invalidModel] }),
        fetchModelConfig: () => invalidModel,
      },
      credentialStore,
    });

    expect(runtime.getStatus().modelCallsEnabled).toBe(false);
    expect(() => runtime.resolveLanguageModel(modelConfigId)).toThrow();
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

  it("resolves and probes an enabled OpenAI speech model", async () => {
    const provider = providerConfig("openai");
    const speechConfig: ModelConfig = {
      ...modelConfig,
      modelType: "speechModel",
      modelId: "gpt-4o-mini-tts",
      metadata: {
        voices: [{ id: "alloy", displayName: "Alloy" }],
      },
      settings: { defaultVoiceId: "alloy" },
    };
    const baseDatabase = runtimeDatabase(provider);
    let probeCount = 0;
    const runtime = await createAiRuntime({
      database: {
        ...baseDatabase,
        listModelConfigs: () => ({ modelConfigs: [speechConfig] }),
        fetchModelConfig: () => speechConfig,
      },
      credentialStore,
      speechConnectionProbe: async () => {
        probeCount += 1;
      },
    });

    expect(runtime.resolveSpeechModel(modelConfigId)).toMatchObject({
      model: { modelId: "gpt-4o-mini-tts" },
      output: {
        requestFormat: "wav",
        format: "wav",
        mediaType: "audio/wav",
      },
    });
    expect(runtime.listAvailableModelConfigIds()).toEqual([
      modelConfigId,
    ]);
    await expect(runtime.testConnection(modelConfigId)).resolves.toMatchObject({
      success: true,
    });
    expect(probeCount).toBe(1);
  });

  it("resolves Google Gemini TTS and probes with the model-level voice", async () => {
    const provider = providerConfig("google");
    const speechConfig: ModelConfig = {
      ...modelConfig,
      modelType: "speechModel",
      modelId: "gemini-2.5-flash-preview-tts",
      metadata: {
        voices: [{ id: "Kore", displayName: "Kore" }],
      },
      settings: { defaultVoiceId: "Kore" },
    };
    const baseDatabase = runtimeDatabase(provider);
    let probedVoice: string | null = null;
    const runtime = await createAiRuntime({
      database: {
        ...baseDatabase,
        listModelConfigs: () => ({ modelConfigs: [speechConfig] }),
        fetchModelConfig: () => speechConfig,
      },
      credentialStore,
      speechConnectionProbe: async (_model, _capability, voiceId) => {
        probedVoice = voiceId;
      },
    });

    expect(runtime.resolveSpeechModel(modelConfigId)).toMatchObject({
      model: {
        modelId: "gemini-2.5-flash-preview-tts",
      },
      output: {
        requestFormat: "wav",
        format: "wav",
        mediaType: "audio/wav",
      },
    });
    await expect(runtime.testConnection(modelConfigId)).resolves.toMatchObject({
      success: true,
    });
    expect(probedVoice).toBe("Kore");
  });

  it("rejects speech models when the Provider Definition has no speech Adapter", async () => {
    const provider = providerConfig("anthropic");
    const speechConfig: ModelConfig = {
      ...modelConfig,
      modelType: "speechModel",
      metadata: {
        voices: null,
      },
      settings: { defaultVoiceId: null },
    };
    const baseDatabase = runtimeDatabase(provider);
    const runtime = await createAiRuntime({
      database: {
        ...baseDatabase,
        listModelConfigs: () => ({ modelConfigs: [speechConfig] }),
        fetchModelConfig: () => speechConfig,
      },
      credentialStore,
    });

    expect(() => runtime.resolveSpeechModel(modelConfigId)).toThrow(
      /no speechModel Adapter/,
    );
    expect(runtime.listAvailableModelConfigIds()).toEqual([]);
  });
});
