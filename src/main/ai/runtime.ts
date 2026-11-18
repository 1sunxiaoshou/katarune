import {
  createProviderRegistry,
  defaultSettingsMiddleware,
  wrapLanguageModel,
  type LanguageModel,
  type SpeechResult,
} from "ai";
import { hasTimestampedSpeech, type TimestampedSpeechModel } from "./timestampedSpeech";
import { providerToolEnabled } from "../../shared/providers";
import { hasStreamingSpeech, type StreamingSpeechModel } from "./streamingSpeech";
import {
  aiRuntimeStatusSchema,
  modelConnectionTestResultSchema,
  providerCredentialIsAvailable,
  speechModelSettingsSchema,
  type AiRuntimeStatus,
  type ModelConnectionTestResult,
  type ProviderToolDescriptor,
} from "../../shared/ipc";
import type { DatabaseRuntime } from "../database/database";
import type { CredentialStore } from "../security/credentialStore";
import { providerToolSupportsScope, type ProviderChatTools, type ProviderToolContext, type ProviderToolDefinition, type ProviderToolScope } from "./providerTools";
import {
  createProviderDefinitionRegistry,
  getProviderDefinition,
  validateModelConfigSettings,
  validateProviderSettings,
  type LanguageConnectionProbe,
  type NormalizedSpeechAudio,
  type ProviderDefinitionRegistry,
  type RegistryProvider,
  type SpeechConnectionProbe,
} from "./providerDefinitions";

type ProviderRegistry = ReturnType<
  typeof createProviderRegistry<Record<string, RegistryProvider>, ":">
>;
export type ResolvedLanguageModel = Exclude<LanguageModel, string>;
type ResolvedAiSdkSpeechModel = Exclude<
  ReturnType<ProviderRegistry["speechModel"]>,
  string
>;

export interface ResolvedSpeechModel {
  readonly streamSpeech?: StreamingSpeechModel["streamSpeech"];
  readonly generateWithTimestamps?: TimestampedSpeechModel["generateWithTimestamps"];
  readonly model: ResolvedAiSdkSpeechModel;
  readonly output: {
    readonly requestFormat: string;
    readonly format: string;
    readonly mediaType: `audio/${string}`;
  };
  normalizeAudio(audio: SpeechResult["audio"]): NormalizedSpeechAudio;
  validateAudio(audio: Uint8Array): boolean;
}

export type AiRuntimeDatabase = Pick<
  DatabaseRuntime,
  "listProviderConfigs" | "listModelConfigs" | "fetchProviderConfig" | "fetchModelConfig"
>;

export interface AiRuntime {
  readonly registry: ProviderRegistry;
  getStatus(): AiRuntimeStatus;
  reload(): Promise<void>;
  listAvailableModelConfigIds(): readonly string[];
  resolveLanguageModel(modelConfigId: string): ResolvedLanguageModel;
  resolveSpeechModel(modelConfigId: string): ResolvedSpeechModel;
  listProviderTools(providerConfigId: string, scope?: ProviderToolScope): readonly ProviderToolDescriptor[];
  createProviderChatTools(context: ProviderToolContext, scope?: ProviderToolScope): ProviderChatTools;
  testConnection(modelConfigId: string): Promise<ModelConnectionTestResult>;
}

interface CreateAiRuntimeOptions {
  readonly database: AiRuntimeDatabase;
  readonly credentialStore: CredentialStore;
  readonly connectionProbe?: LanguageConnectionProbe;
  readonly speechConnectionProbe?: SpeechConnectionProbe;
  readonly providerDefinitions?: ProviderDefinitionRegistry;
}

export async function createAiRuntime({
  database,
  credentialStore,
  connectionProbe,
  speechConnectionProbe,
  providerDefinitions = createProviderDefinitionRegistry({
    ...(connectionProbe === undefined
      ? {}
      : { languageConnectionProbe: connectionProbe }),
    ...(speechConnectionProbe === undefined
      ? {}
      : { speechConnectionProbe }),
  }),
}: CreateAiRuntimeOptions): Promise<AiRuntime> {
  let registry: ProviderRegistry = createProviderRegistry({});
  let registeredProviderIds = new Set<string>();
  let registeredTools = new Map<string, { tool: ProviderToolDefinition; apiKey: string }>();
  let status = aiRuntimeStatusSchema.parse({
    ready: true,
    configuredProviderCount: 0,
    modelCallsEnabled: false,
  });

  const reload = async (): Promise<void> => {
    const providers: Record<string, RegistryProvider> = {};
    const nextTools: typeof registeredTools = new Map();

    for (const config of database.listProviderConfigs().providerConfigs) {
      if (!config.enabled) continue;
      const definition = getProviderDefinition(
        config.providerType,
        providerDefinitions,
      );
      if (
        !providerCredentialIsAvailable(
          config.providerType,
          config.credentialRef,
        )
      ) {
        continue;
      }

      try {
        validateProviderSettings(
          config.providerType,
          config.settings,
          providerDefinitions,
        );
        const apiKey =
          config.credentialRef === null
            ? undefined
            : await credentialStore.resolve(config.credentialRef);
        providers[config.id] = definition.createProvider(config, apiKey);
        if (apiKey && definition.toolCatalog?.supports(config)) {
          for (const tool of definition.toolCatalog.tools) {
            if (providerToolEnabled(config.settings, tool.settingKey) && !nextTools.has(tool.id)) {
              nextTools.set(tool.id, { tool, apiKey });
            }
          }
        }
      } catch {
        // An invalid or unavailable config remains persisted but is not exposed as callable.
      }
    }

    registry = createProviderRegistry(providers);
    registeredProviderIds = new Set(Object.keys(providers));
    registeredTools = nextTools;
    const modelCallsEnabled = database.listModelConfigs().modelConfigs.some((modelConfig) => {
      if (!modelConfig.enabled || modelConfig.modelType !== "languageModel") return false;
      const providerConfig = database.fetchProviderConfig(modelConfig.providerConfigId);
      if (!providerConfig.enabled || !registeredProviderIds.has(providerConfig.id)) {
        return false;
      }
      try {
        const definition = getProviderDefinition(
          providerConfig.providerType,
          providerDefinitions,
        );
        validateModelConfigSettings(
          providerConfig,
          modelConfig,
          providerDefinitions,
        );
        return definition.languageModel !== undefined;
      } catch {
        return false;
      }
    });
    status = aiRuntimeStatusSchema.parse({
      ready: true,
      configuredProviderCount: registeredProviderIds.size,
      modelCallsEnabled,
    });
  };

  const resolveLanguageModel = (
    modelConfigId: string,
  ): ResolvedLanguageModel => {
    const modelConfig = database.fetchModelConfig(modelConfigId);
    if (!modelConfig.enabled) {
      throw new Error(`Model config "${modelConfigId}" is disabled.`);
    }
    if (modelConfig.modelType !== "languageModel") {
      throw new Error(
        `Model config "${modelConfigId}" has type "${modelConfig.modelType}", not "languageModel".`,
      );
    }

    const providerConfig = database.fetchProviderConfig(modelConfig.providerConfigId);
    if (!providerConfig.enabled || !registeredProviderIds.has(providerConfig.id)) {
      throw new Error(`Provider config "${providerConfig.id}" is not callable.`);
    }
    const definition = getProviderDefinition(
      providerConfig.providerType,
      providerDefinitions,
    );
    if (definition.languageModel === undefined) {
      throw new Error(
        `Provider type "${providerConfig.providerType}" has no languageModel Adapter.`,
      );
    }
    validateModelConfigSettings(
      providerConfig,
      modelConfig,
      providerDefinitions,
    );

    const model = definition.languageModel.createModel(
      registry,
      `${providerConfig.id}:${modelConfig.modelId}` as `${string}:${string}`,
    );
    return modelConfig.settings === null
      ? model
      : wrapLanguageModel({
          model,
          middleware: defaultSettingsMiddleware({ settings: modelConfig.settings }),
        });
  };

  const resolveSpeechModel = (modelConfigId: string): ResolvedSpeechModel => {
    const modelConfig = database.fetchModelConfig(modelConfigId);
    if (!modelConfig.enabled) {
      throw new Error(`Model config "${modelConfigId}" is disabled.`);
    }
    if (modelConfig.modelType !== "speechModel") {
      throw new Error(
        `Model config "${modelConfigId}" has type "${modelConfig.modelType}", not "speechModel".`,
      );
    }

    const providerConfig = database.fetchProviderConfig(modelConfig.providerConfigId);
    if (!providerConfig.enabled || !registeredProviderIds.has(providerConfig.id)) {
      throw new Error(`Provider config "${providerConfig.id}" is not callable.`);
    }
    const definition = getProviderDefinition(
      providerConfig.providerType,
      providerDefinitions,
    );
    const speech = definition.speechModel;
    if (speech === undefined) {
      throw new Error(
        `Provider type "${providerConfig.providerType}" has no speechModel Adapter.`,
      );
    }
    validateModelConfigSettings(
      providerConfig,
      modelConfig,
      providerDefinitions,
    );

    const model = speech.createModel(
        registry,
        `${providerConfig.id}:${modelConfig.modelId}` as `${string}:${string}`,
      );
    return {
      model,
      ...(hasTimestampedSpeech(model) ? { generateWithTimestamps: model.generateWithTimestamps.bind(model) } : {}),
      ...(hasStreamingSpeech(model) ? { streamSpeech: model.streamSpeech.bind(model) } : {}),
      output: speech.output,
      normalizeAudio: speech.normalizeAudio,
      validateAudio: speech.validateAudio,
    };
  };

  const runtime: AiRuntime = {
    get registry() {
      return registry;
    },
    getStatus: () => status,
    reload,
    listAvailableModelConfigIds: () =>
      database
        .listModelConfigs()
        .modelConfigs.filter((modelConfig) => modelConfig.enabled)
        .filter((modelConfig) => {
          try {
            if (modelConfig.modelType === "languageModel") {
              resolveLanguageModel(modelConfig.id);
            } else if (modelConfig.modelType === "speechModel") {
              resolveSpeechModel(modelConfig.id);
            } else {
              return false;
            }
            return true;
          } catch {
            return false;
          }
        })
        .map((modelConfig) => modelConfig.id),
    resolveLanguageModel,
    resolveSpeechModel,
    listProviderTools: (providerConfigId, scope = "chat") => {
      const config = database.fetchProviderConfig(providerConfigId);
      const catalog = getProviderDefinition(config.providerType, providerDefinitions).toolCatalog;
      return catalog?.supports(config) ? catalog.tools
        .filter(tool => providerToolSupportsScope(tool, scope))
        .map(({ id, name, apiPath, settingKey, description, billing, kind }) =>
          ({ id, name, apiPath, settingKey, description, billing, kind })) : [];
    },
    createProviderChatTools: (context, scope = "chat") => {
      const tools: ProviderChatTools["tools"] = {};
      const available: ProviderToolDefinition[] = [];
      for (const { tool, apiKey } of registeredTools.values()) {
        if (!providerToolSupportsScope(tool, scope)) continue;
        const implementation = tool.createTool(apiKey, context);
        if (implementation) {
          tools[tool.id] = implementation;
          available.push(tool);
        }
      }
      return { tools, attachmentTool: filename => available.find(tool => tool.acceptsAttachment?.(filename))?.id };
    },
    testConnection: async (modelConfigId) => {
      const startedAt = Date.now();
      try {
        const modelConfig = database.fetchModelConfig(modelConfigId);
        const providerConfig = database.fetchProviderConfig(
          modelConfig.providerConfigId,
        );
        const definition = getProviderDefinition(
          providerConfig.providerType,
          providerDefinitions,
        );
        if (modelConfig.modelType === "languageModel") {
          if (definition.languageModel === undefined) {
            throw new Error(
              `Provider type "${providerConfig.providerType}" has no languageModel Adapter.`,
            );
          }
          await definition.languageModel.testConnection(
            resolveLanguageModel(modelConfigId),
          );
        } else if (modelConfig.modelType === "speechModel") {
          if (definition.speechModel === undefined) {
            throw new Error(
              `Provider type "${providerConfig.providerType}" has no speechModel Adapter.`,
            );
          }
          const voiceId = speechModelSettingsSchema.parse(
            modelConfig.settings,
          ).defaultVoiceId;
          if (voiceId == null) {
            throw new Error(
              "The speech model has no model-level default voice.",
            );
          }
          await definition.speechModel.testConnection(
            resolveSpeechModel(modelConfigId).model,
            voiceId,
          );
        } else {
          throw new Error(`Unsupported model type "${modelConfig.modelType}".`);
        }
        return modelConnectionTestResultSchema.parse({
          modelConfigId,
          success: true,
          latencyMs: Date.now() - startedAt,
          message: "连接成功。",
        });
      } catch (error) {
        const errorName = error instanceof Error ? error.name : "UnknownError";
        return modelConnectionTestResultSchema.parse({
          modelConfigId,
          success: false,
          latencyMs: Date.now() - startedAt,
          message: `连接失败（${errorName}）。请检查端点、凭据和模型 ID。`,
        });
      }
    },
  };

  await runtime.reload();
  return runtime;
}
