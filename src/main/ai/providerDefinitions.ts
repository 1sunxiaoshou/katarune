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
  languageModelSettingsSchema,
  type JsonObject,
  type ModelConfig,
  type ProviderConfig,
} from "../../shared/ipc";
import type { ModelType } from "../../shared/models";
import {
  PROVIDER_CAPABILITIES,
  type ProviderCapabilityMetadata,
  type ProviderType,
  type SpeechOutputMetadata,
} from "../../shared/providers";

export type RegistryProvider = Parameters<typeof createProviderRegistry>[0][string];
type ResolvedLanguageModel = Exclude<LanguageModel, string>;
type ProviderRegistry = ReturnType<
  typeof createProviderRegistry<Record<string, RegistryProvider>, ":">
>;
type ResolvedSpeechModel = ReturnType<ProviderRegistry["speechModel"]>;

type SettingsSchema = {
  parse(value: unknown): unknown;
};

export type LanguageConnectionProbe = (model: LanguageModel) => Promise<void>;
export type SpeechConnectionProbe = (
  model: SpeechModel,
  capability: SpeechCapabilityDefinition,
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
  readonly defaultVoice: string | null;
  readonly output: SpeechOutputMetadata & {
    readonly requestFormat: string;
  };
  createModel(
    registry: ProviderModelRegistry,
    id: `${string}:${string}`,
  ): ResolvedSpeechModel;
  normalizeAudio(audio: SpeechResult["audio"]): NormalizedSpeechAudio;
  validateAudio(audio: Uint8Array): boolean;
  testConnection(model: SpeechModel): Promise<void>;
}

export interface ProviderDefinition {
  readonly metadata: ProviderCapabilityMetadata;
  readonly providerSettingsSchema: SettingsSchema;
  readonly languageModel?: LanguageCapabilityDefinition;
  readonly speechModel?: SpeechCapabilityDefinition;
  createProvider(config: ProviderConfig, apiKey: string | undefined): RegistryProvider;
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
) => {
  const voice = capability.defaultVoice;
  if (voice === null) {
    throw new Error("The speech Adapter does not define a connection-test voice.");
  }
  const result = await generateSpeech({
    model,
    text: "OK",
    voice,
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

export function createProviderDefinitionRegistry({
  languageConnectionProbe = defaultLanguageConnectionProbe,
  speechConnectionProbe = defaultSpeechConnectionProbe,
}: {
  readonly languageConnectionProbe?: LanguageConnectionProbe;
  readonly speechConnectionProbe?: SpeechConnectionProbe;
} = {}): ProviderDefinitionRegistry {
  const languageModel = commonLanguageCapability(languageConnectionProbe);
  const openAiSpeechMetadata = PROVIDER_CAPABILITIES.openai.speech;
  const openAiSpeech: SpeechCapabilityDefinition = {
    settingsSchema: nullSettingsSchema,
    defaultVoice: openAiSpeechMetadata.defaultVoice,
    output: {
      ...openAiSpeechMetadata.preferredOutput,
      requestFormat: openAiSpeechMetadata.preferredOutput.format,
    },
    createModel: (registry, id) => registry.speechModel(id),
    normalizeAudio: (audio) => ({
      audio: new Uint8Array(audio.uint8Array),
      format: audio.format,
      mediaType: audio.mediaType as `audio/${string}`,
    }),
    validateAudio: isValidWav,
    testConnection: async (model) => speechConnectionProbe(model, openAiSpeech),
  };

  return {
    gateway: {
      metadata: PROVIDER_CAPABILITIES.gateway,
      providerSettingsSchema: nullableProviderSettingsSchema,
      languageModel,
      createProvider: (config, apiKey) =>
        createGateway(optionalFactorySettings(config, apiKey)),
    },
    "openai-compatible": {
      metadata: PROVIDER_CAPABILITIES["openai-compatible"],
      providerSettingsSchema: nullableProviderSettingsSchema,
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
            : { supportsStructuredOutputs: settings.supportsStructuredOutputs }),
        });
      },
    },
    openai: {
      metadata: PROVIDER_CAPABILITIES.openai,
      providerSettingsSchema: nullableProviderSettingsSchema,
      languageModel,
      speechModel: openAiSpeech,
      createProvider: (config, apiKey) =>
        createOpenAI(optionalFactorySettings(config, apiKey)),
    },
    anthropic: {
      metadata: PROVIDER_CAPABILITIES.anthropic,
      providerSettingsSchema: nullableProviderSettingsSchema,
      languageModel,
      createProvider: (config, apiKey) =>
        createAnthropic(optionalFactorySettings(config, apiKey)),
    },
    google: {
      metadata: PROVIDER_CAPABILITIES.google,
      providerSettingsSchema: nullableProviderSettingsSchema,
      languageModel,
      createProvider: (config, apiKey) =>
        createGoogle(optionalFactorySettings(config, apiKey)),
    },
    deepseek: {
      metadata: PROVIDER_CAPABILITIES.deepseek,
      providerSettingsSchema: nullableProviderSettingsSchema,
      languageModel,
      createProvider: (config, apiKey) =>
        createDeepSeek(optionalFactorySettings(config, apiKey)),
    },
    xai: {
      metadata: PROVIDER_CAPABILITIES.xai,
      providerSettingsSchema: nullableProviderSettingsSchema,
      languageModel,
      createProvider: (config, apiKey) =>
        createXai(optionalFactorySettings(config, apiKey)),
    },
    moonshotai: {
      metadata: PROVIDER_CAPABILITIES.moonshotai,
      providerSettingsSchema: nullableProviderSettingsSchema,
      languageModel,
      createProvider: (config, apiKey) =>
        createMoonshotAI(optionalFactorySettings(config, apiKey)),
    },
    alibaba: {
      metadata: PROVIDER_CAPABILITIES.alibaba,
      providerSettingsSchema: nullableProviderSettingsSchema,
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
  getProviderDefinition(providerType, registry).providerSettingsSchema.parse(settings);
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
