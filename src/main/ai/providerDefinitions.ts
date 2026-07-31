import { createAlibaba } from "@ai-sdk/alibaba";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { createGoogle } from "@ai-sdk/google";
import { createMoonshotAI } from "@ai-sdk/moonshotai";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createXai } from "@ai-sdk/xai";
import {
  createGateway,
  createProviderRegistry,
  generateSpeech,
  generateText,
  type LanguageModel,
  type SpeechModel,
  type SpeechResult,
} from "ai";
import * as z from "zod/mini";

import {
  discoveredModelListSchema,
  languageModelSettingsSchema,
  speechModelMetadataSchema,
  type JsonObject,
  type ModelConfig,
  type ModelType,
  type ProviderConfig,
  type SpeechModelMetadata,
} from "../../shared/ipc";
import type { ProviderType } from "../../shared/providers";
import { createFishAudio } from "./fishAudioProvider";
import {
  bearerHeaders,
  createHttpModelDiscovery,
  discoverGatewayModels,
  normalizeGoogleModels,
  normalizeOpenAiModels,
  stringField,
  type ProviderModelDiscovery,
  type ProviderModelDiscoveryContext,
} from "./providerModelDiscovery";

export type RegistryProvider = Parameters<typeof createProviderRegistry>[0][string];
type ResolvedLanguageModel = Exclude<LanguageModel, string>;
type ProviderRegistry = ReturnType<
  typeof createProviderRegistry<Record<string, RegistryProvider>, ":">
>;
type ResolvedSpeechModel = ReturnType<ProviderRegistry["speechModel"]>;

type SettingsSchema = {
  parse(value: unknown): unknown;
};

interface SpeechOutputMetadata {
  readonly format: string;
  readonly mediaType: `audio/${string}`;
}

export interface ProviderModelInspection {
  readonly modelType: ModelType | null;
  readonly displayName: string | null;
  readonly speechMetadata: SpeechModelMetadata | null;
}

export type ProviderModelInspector = (
  context: ProviderModelDiscoveryContext,
  modelId: string,
) => Promise<ProviderModelInspection>;

export type LanguageConnectionProbe = (model: LanguageModel) => Promise<void>;
export type SpeechConnectionProbe = (
  model: SpeechModel,
  capability: SpeechCapabilityDefinition,
  voiceId: string,
) => Promise<void>;

export interface NormalizedSpeechAudio extends SpeechOutputMetadata {
  readonly audio: Uint8Array;
}

export interface ProviderModelRegistry {
  languageModel(id: `${string}:${string}`): ResolvedLanguageModel;
  speechModel(id: `${string}:${string}`): ResolvedSpeechModel;
}

export interface LanguageCapabilityDefinition {
  readonly settingsSchema: SettingsSchema;
  createModel(
    registry: ProviderModelRegistry,
    id: `${string}:${string}`,
  ): ResolvedLanguageModel;
  testConnection(model: LanguageModel): Promise<void>;
}

export interface SpeechCapabilityDefinition {
  readonly settingsSchema: SettingsSchema;
  readonly output: SpeechOutputMetadata & {
    readonly requestFormat: string;
  };
  createModel(
    registry: ProviderModelRegistry,
    id: `${string}:${string}`,
  ): ResolvedSpeechModel;
  normalizeAudio(audio: SpeechResult["audio"]): NormalizedSpeechAudio;
  validateAudio(audio: Uint8Array): boolean;
  testConnection(model: SpeechModel, voiceId: string): Promise<void>;
}

export interface ProviderDefinition {
  readonly providerSettingsSchema: SettingsSchema;
  readonly discoverModels: ProviderModelDiscovery;
  readonly inspectModel: ProviderModelInspector;
  readonly languageModel?: LanguageCapabilityDefinition;
  readonly speechModel?: SpeechCapabilityDefinition;
  createProvider(
    config: ProviderConfig,
    apiKey: string | undefined,
  ): RegistryProvider;
}

export type ProviderDefinitionRegistry = Readonly<
  Record<ProviderType, ProviderDefinition>
>;

const providerSettingsSchema = z.strictObject({
  includeUsage: z.optional(z.boolean()),
  supportsStructuredOutputs: z.optional(z.boolean()),
});
const nullableProviderSettingsSchema = z.nullable(providerSettingsSchema);
const nullableLanguageSettingsSchema = z.nullable(languageModelSettingsSchema);
const nullSettingsSchema = z.null();

const defaultLanguageConnectionProbe: LanguageConnectionProbe = async (model) => {
  await generateText({
    model,
    prompt: "Reply with OK.",
    maxOutputTokens: 8,
    maxRetries: 0,
    timeout: 15_000,
  });
};

const defaultSpeechConnectionProbe: SpeechConnectionProbe = async (
  model,
  capability,
  voiceId,
) => {
  const result = await generateSpeech({
    model,
    text: "OK",
    voice: voiceId,
    outputFormat: capability.output.requestFormat,
    maxRetries: 0,
    abortSignal: AbortSignal.timeout(15_000),
  });
  const normalized = capability.normalizeAudio(result.audio);
  if (
    normalized.format !== capability.output.format ||
    normalized.mediaType !== capability.output.mediaType ||
    !capability.validateAudio(normalized.audio)
  ) {
    throw new Error("The speech connection probe returned invalid audio.");
  }
};

function isValidWav(audio: Uint8Array): boolean {
  return (
    audio.byteLength >= 44 &&
    audio[0] === 0x52 &&
    audio[1] === 0x49 &&
    audio[2] === 0x46 &&
    audio[3] === 0x46 &&
    audio[8] === 0x57 &&
    audio[9] === 0x41 &&
    audio[10] === 0x56 &&
    audio[11] === 0x45
  );
}

function optionalFactorySettings(
  config: ProviderConfig,
  apiKey: string | undefined,
): { apiKey?: string; baseURL?: string } {
  return {
    ...(apiKey === undefined ? {} : { apiKey }),
    ...(config.baseUrl === null ? {} : { baseURL: config.baseUrl }),
  };
}

function commonLanguageCapability(
  connectionProbe: LanguageConnectionProbe,
): LanguageCapabilityDefinition {
  return {
    settingsSchema: nullableLanguageSettingsSchema,
    createModel: (registry, id) => registry.languageModel(id),
    testConnection: connectionProbe,
  };
}

function createSpeechCapability(
  speechConnectionProbe: SpeechConnectionProbe,
): SpeechCapabilityDefinition {
  const capability: SpeechCapabilityDefinition = {
    settingsSchema: nullSettingsSchema,
    output: {
      requestFormat: "wav",
      format: "wav",
      mediaType: "audio/wav",
    },
    createModel: (registry, id) => registry.speechModel(id),
    normalizeAudio: (audio) => ({
      audio: new Uint8Array(audio.uint8Array),
      format: audio.format,
      mediaType: audio.mediaType as `audio/${string}`,
    }),
    validateAudio: isValidWav,
    testConnection: async (model, voiceId) =>
      speechConnectionProbe(model, capability, voiceId),
  };
  return capability;
}

function responseRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null;
}

function googleNextPageUrl(value: unknown, currentUrl: URL): URL | null {
  const token = stringField(responseRecord(value)?.nextPageToken, 1_000);
  if (token === null) return null;
  const nextUrl = new URL(currentUrl);
  nextUrl.searchParams.set("pageToken", token);
  return nextUrl;
}

function anthropicNextPageUrl(value: unknown, currentUrl: URL): URL | null {
  const response = responseRecord(value);
  if (response?.has_more !== true) return null;
  const lastId = stringField(response.last_id, 500);
  if (lastId === null) return null;
  const nextUrl = new URL(currentUrl);
  nextUrl.searchParams.set("after_id", lastId);
  return nextUrl;
}

const gatewayDiscovery = discoverGatewayModels;
const openAiCompatibleDiscovery = createHttpModelDiscovery({
  defaultBaseUrl: null,
  createHeaders: bearerHeaders,
  normalizeModels: normalizeOpenAiModels,
});
const openAiDiscovery = createHttpModelDiscovery({
  defaultBaseUrl: "https://api.openai.com/v1",
  liteLlmCatalogAlias: "openai",
  createHeaders: bearerHeaders,
  normalizeModels: normalizeOpenAiModels,
});
const anthropicDiscovery = createHttpModelDiscovery({
  defaultBaseUrl: "https://api.anthropic.com/v1",
  liteLlmCatalogAlias: "anthropic",
  configureUrl: (url) => url.searchParams.set("limit", "1000"),
  nextPageUrl: anthropicNextPageUrl,
  createHeaders: (apiKey) => {
    const headers = new Headers({
      Accept: "application/json",
      "anthropic-version": "2023-06-01",
    });
    if (apiKey !== undefined) headers.set("x-api-key", apiKey);
    return headers;
  },
  normalizeModels: normalizeOpenAiModels,
});
const googleDiscovery = createHttpModelDiscovery({
  defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
  liteLlmCatalogAlias: "gemini",
  configureUrl: (url) => url.searchParams.set("pageSize", "1000"),
  nextPageUrl: googleNextPageUrl,
  createHeaders: (apiKey) => {
    const headers = new Headers({ Accept: "application/json" });
    if (apiKey !== undefined) headers.set("x-goog-api-key", apiKey);
    return headers;
  },
  normalizeModels: normalizeGoogleModels,
});
const deepSeekDiscovery = createHttpModelDiscovery({
  defaultBaseUrl: "https://api.deepseek.com",
  liteLlmCatalogAlias: "deepseek",
  createHeaders: bearerHeaders,
  normalizeModels: normalizeOpenAiModels,
});
const xaiDiscovery = createHttpModelDiscovery({
  defaultBaseUrl: "https://api.x.ai/v1",
  liteLlmCatalogAlias: "xai",
  createHeaders: bearerHeaders,
  normalizeModels: normalizeOpenAiModels,
});
const moonshotDiscovery = createHttpModelDiscovery({
  defaultBaseUrl: "https://api.moonshot.ai/v1",
  liteLlmCatalogAlias: "moonshot",
  createHeaders: bearerHeaders,
  normalizeModels: normalizeOpenAiModels,
});
const alibabaDiscovery = createHttpModelDiscovery({
  defaultBaseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
  liteLlmCatalogAlias: "dashscope",
  createHeaders: bearerHeaders,
  normalizeModels: normalizeOpenAiModels,
});

const FISH_AUDIO_TTS_MODELS = [
  { id: "s2.1-pro-free", displayName: "Fish Audio S2.1 Pro Free" },
  { id: "s2.1-pro", displayName: "Fish Audio S2.1 Pro" },
  { id: "s2-pro", displayName: "Fish Audio S2 Pro" },
  { id: "s1", displayName: "Fish Audio S1" },
] as const;

const fishAudioDiscovery: ProviderModelDiscovery = async () =>
  discoveredModelListSchema.parse({
    models: FISH_AUDIO_TTS_MODELS.map((model) => ({
      ...model,
      modelType: "speechModel" as const,
      typeSource: null,
    })),
    source: "provider",
    warning: null,
  });

function fishAudioBaseUrl(context: ProviderModelDiscoveryContext): string {
  return (context.provider.baseUrl ?? "https://api.fish.audio").replace(
    /\/+$/,
    "",
  );
}

function fishAudioVoiceOption(
  value: unknown,
): { id: string; displayName: string; description?: string } | null {
  const record = responseRecord(value);
  if (record?.type !== "tts" || record.state !== "trained") return null;
  const id = stringField(record._id, 200);
  if (id === null) return null;
  const displayName = stringField(record.title, 200) ?? id;
  const description = stringField(record.description, 500);
  return {
    id,
    displayName,
    ...(description === null ? {} : { description }),
  };
}

async function discoverFishAudioVoices(
  context: ProviderModelDiscoveryContext,
): Promise<SpeechModelMetadata> {
  const voices = new Map<
    string,
    { id: string; displayName: string; description?: string }
  >();
  for (let page = 1; page <= 10; page += 1) {
    const url = new URL(`${fishAudioBaseUrl(context)}/model`);
    url.searchParams.set("page_size", "100");
    url.searchParams.set("page_number", String(page));
    url.searchParams.set("self", "true");
    url.searchParams.set("sort_by", "created_at");

    const response = await context.fetchImplementation(url, {
      method: "GET",
      headers: bearerHeaders(context.apiKey),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      throw new Error(`获取 Fish Audio 音色失败（HTTP ${response.status}）。`);
    }
    const body = responseRecord(await response.json());
    const items = Array.isArray(body?.items) ? body.items : null;
    if (items === null) {
      throw new Error("Fish Audio 音色接口返回了无效数据。");
    }
    const total = body?.total;
    if (
      typeof total === "number" &&
      Number.isInteger(total) &&
      total > 1_000
    ) {
      throw new Error(
        "Fish Audio 账号音色超过 1000 个，无法安全保存为完整音色目录。",
      );
    }
    for (const item of items) {
      const voice = fishAudioVoiceOption(item);
      if (voice !== null) voices.set(voice.id, voice);
    }

    const hasMore =
      body?.has_more === true ||
      (typeof total === "number" && page * 100 < total);
    if (!hasMore) break;
    if (page === 10) {
      throw new Error(
        "Fish Audio 音色目录超过 10 页，无法安全保存为完整音色目录。",
      );
    }
  }

  return speechModelMetadataSchema.parse({
    voices: voices.size === 0 ? null : [...voices.values()],
    defaultVoiceId: null,
  });
}

const fishAudioInspector: ProviderModelInspector = async (context, modelId) => {
  const model = FISH_AUDIO_TTS_MODELS.find((item) => item.id === modelId);
  if (model === undefined) {
    return {
      modelType: null,
      displayName: null,
      speechMetadata: null,
    };
  }
  return {
    modelType: "speechModel",
    displayName: model.displayName,
    speechMetadata: await discoverFishAudioVoices(context),
  };
};

const OPENAI_SPEECH_METADATA = speechModelMetadataSchema.parse({
  voices: [
    "alloy",
    "ash",
    "ballad",
    "coral",
    "echo",
    "fable",
    "onyx",
    "nova",
    "sage",
    "shimmer",
    "verse",
    "marin",
    "cedar",
  ].map((id) => ({
    id,
    displayName: id[0]?.toUpperCase() + id.slice(1),
  })),
  defaultVoiceId: "alloy",
});

const GOOGLE_SPEECH_METADATA = speechModelMetadataSchema.parse({
  voices: [
    ["Zephyr", "Bright"],
    ["Puck", "Upbeat"],
    ["Charon", "Informative"],
    ["Kore", "Firm"],
    ["Fenrir", "Excitable"],
    ["Leda", "Youthful"],
    ["Orus", "Firm"],
    ["Aoede", "Breezy"],
    ["Callirrhoe", "Easy-going"],
    ["Autonoe", "Bright"],
    ["Enceladus", "Breathy"],
    ["Iapetus", "Clear"],
    ["Umbriel", "Easy-going"],
    ["Algieba", "Smooth"],
    ["Despina", "Smooth"],
    ["Erinome", "Clear"],
    ["Algenib", "Gravelly"],
    ["Rasalgethi", "Informative"],
    ["Laomedeia", "Upbeat"],
    ["Achernar", "Soft"],
    ["Alnilam", "Firm"],
    ["Schedar", "Even"],
    ["Gacrux", "Mature"],
    ["Pulcherrima", "Forward"],
    ["Achird", "Friendly"],
    ["Zubenelgenubi", "Casual"],
    ["Vindemiatrix", "Gentle"],
    ["Sadachbia", "Lively"],
    ["Sadaltager", "Knowledgeable"],
    ["Sulafat", "Warm"],
  ].map(([id, description]) => ({
    id: id ?? "",
    displayName: id ?? "",
    description,
  })),
  defaultVoiceId: "Kore",
});

function discoveryBackedInspector(
  discoverModels: ProviderModelDiscovery,
  speechMetadata?: (
    modelId: string,
    discoveredType: ModelType | null,
  ) => SpeechModelMetadata | null,
): ProviderModelInspector {
  return async (context, modelId) => {
    const discovered = (await discoverModels(context)).models.find(
      (model) => model.id === modelId,
    );
    let modelType = discovered?.modelType ?? null;
    const metadata = speechMetadata?.(modelId, modelType) ?? null;
    if (modelType === null && metadata !== null) modelType = "speechModel";
    return {
      modelType,
      displayName: discovered?.displayName ?? null,
      speechMetadata: modelType === "speechModel" ? metadata : null,
    };
  };
}

function knownSpeechModelId(modelId: string): boolean {
  return /(?:^tts-|[-.]tts(?:[-.]|$))/i.test(modelId);
}

export function createProviderDefinitionRegistry({
  languageConnectionProbe = defaultLanguageConnectionProbe,
  speechConnectionProbe = defaultSpeechConnectionProbe,
}: {
  readonly languageConnectionProbe?: LanguageConnectionProbe;
  readonly speechConnectionProbe?: SpeechConnectionProbe;
} = {}): ProviderDefinitionRegistry {
  const languageModel = commonLanguageCapability(languageConnectionProbe);
  const speechModel = createSpeechCapability(speechConnectionProbe);

  return {
    gateway: {
      providerSettingsSchema: nullableProviderSettingsSchema,
      discoverModels: gatewayDiscovery,
      inspectModel: discoveryBackedInspector(gatewayDiscovery),
      languageModel,
      createProvider: (config, apiKey) =>
        createGateway(optionalFactorySettings(config, apiKey)),
    },
    "openai-compatible": {
      providerSettingsSchema: nullableProviderSettingsSchema,
      discoverModels: openAiCompatibleDiscovery,
      inspectModel: discoveryBackedInspector(openAiCompatibleDiscovery),
      languageModel,
      createProvider: (config, apiKey) => {
        if (config.baseUrl === null) {
          throw new Error("An OpenAI-compatible Provider requires a base URL.");
        }
        const settings = providerSettingsSchema.parse(config.settings ?? {});
        return createOpenAICompatible({
          name: config.id,
          baseURL: config.baseUrl,
          ...(apiKey === undefined ? {} : { apiKey }),
          ...(settings.includeUsage === undefined
            ? {}
            : { includeUsage: settings.includeUsage }),
          ...(settings.supportsStructuredOutputs === undefined
            ? {}
            : {
                supportsStructuredOutputs:
                  settings.supportsStructuredOutputs,
              }),
        });
      },
    },
    openai: {
      providerSettingsSchema: nullableProviderSettingsSchema,
      discoverModels: openAiDiscovery,
      inspectModel: discoveryBackedInspector(
        openAiDiscovery,
        (modelId, discoveredType) =>
          discoveredType === "speechModel" || knownSpeechModelId(modelId)
            ? OPENAI_SPEECH_METADATA
            : null,
      ),
      languageModel,
      speechModel,
      createProvider: (config, apiKey) =>
        createOpenAI(optionalFactorySettings(config, apiKey)),
    },
    anthropic: {
      providerSettingsSchema: nullableProviderSettingsSchema,
      discoverModels: anthropicDiscovery,
      inspectModel: discoveryBackedInspector(anthropicDiscovery),
      languageModel,
      createProvider: (config, apiKey) =>
        createAnthropic(optionalFactorySettings(config, apiKey)),
    },
    google: {
      providerSettingsSchema: nullableProviderSettingsSchema,
      discoverModels: googleDiscovery,
      inspectModel: discoveryBackedInspector(
        googleDiscovery,
        (modelId, discoveredType) =>
          discoveredType === "speechModel" || knownSpeechModelId(modelId)
            ? GOOGLE_SPEECH_METADATA
            : null,
      ),
      languageModel,
      speechModel,
      createProvider: (config, apiKey) =>
        createGoogle(optionalFactorySettings(config, apiKey)),
    },
    "fish-audio": {
      providerSettingsSchema: nullableProviderSettingsSchema,
      discoverModels: fishAudioDiscovery,
      inspectModel: fishAudioInspector,
      speechModel,
      createProvider: (config, apiKey) =>
        createFishAudio(optionalFactorySettings(config, apiKey)),
    },
    deepseek: {
      providerSettingsSchema: nullableProviderSettingsSchema,
      discoverModels: deepSeekDiscovery,
      inspectModel: discoveryBackedInspector(deepSeekDiscovery),
      languageModel,
      createProvider: (config, apiKey) =>
        createDeepSeek(optionalFactorySettings(config, apiKey)),
    },
    xai: {
      providerSettingsSchema: nullableProviderSettingsSchema,
      discoverModels: xaiDiscovery,
      inspectModel: discoveryBackedInspector(xaiDiscovery),
      languageModel,
      createProvider: (config, apiKey) =>
        createXai(optionalFactorySettings(config, apiKey)),
    },
    moonshotai: {
      providerSettingsSchema: nullableProviderSettingsSchema,
      discoverModels: moonshotDiscovery,
      inspectModel: discoveryBackedInspector(moonshotDiscovery),
      languageModel,
      createProvider: (config, apiKey) =>
        createMoonshotAI(optionalFactorySettings(config, apiKey)),
    },
    alibaba: {
      providerSettingsSchema: nullableProviderSettingsSchema,
      discoverModels: alibabaDiscovery,
      inspectModel: discoveryBackedInspector(alibabaDiscovery),
      languageModel,
      createProvider: (config, apiKey) => {
        const settings = providerSettingsSchema.parse(config.settings ?? {});
        return createAlibaba({
          ...optionalFactorySettings(config, apiKey),
          ...(settings.includeUsage === undefined
            ? {}
            : { includeUsage: settings.includeUsage }),
        });
      },
    },
  } satisfies Record<ProviderType, ProviderDefinition>;
}

export const PROVIDER_DEFINITIONS = createProviderDefinitionRegistry();

export function getProviderDefinition(
  providerType: ProviderType,
  registry: ProviderDefinitionRegistry = PROVIDER_DEFINITIONS,
): ProviderDefinition {
  return registry[providerType];
}

export function validateProviderSettings(
  providerType: ProviderType,
  settings: JsonObject | null,
  registry: ProviderDefinitionRegistry = PROVIDER_DEFINITIONS,
): void {
  getProviderDefinition(providerType, registry).providerSettingsSchema.parse(
    settings,
  );
}

export function validateModelSettings(
  providerType: ProviderType,
  modelType: ModelType,
  settings: JsonObject | null,
  registry: ProviderDefinitionRegistry = PROVIDER_DEFINITIONS,
): void {
  const definition = getProviderDefinition(providerType, registry);
  const capability =
    modelType === "languageModel"
      ? definition.languageModel
      : modelType === "speechModel"
        ? definition.speechModel
        : undefined;
  (capability?.settingsSchema ?? nullSettingsSchema).parse(settings);
}

export function validateModelConfigSettings(
  provider: ProviderConfig,
  model: Pick<ModelConfig, "modelType" | "settings">,
  registry: ProviderDefinitionRegistry = PROVIDER_DEFINITIONS,
): void {
  validateProviderSettings(provider.providerType, provider.settings, registry);
  validateModelSettings(
    provider.providerType,
    model.modelType,
    model.settings,
    registry,
  );
}
