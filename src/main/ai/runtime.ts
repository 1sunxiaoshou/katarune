import {
  createProviderRegistry,
  defaultSettingsMiddleware,
  wrapLanguageModel,
  type LanguageModel,
  type SpeechResult,
} from "ai";
import {
  aiRuntimeStatusSchema,
  modelConnectionTestResultSchema,
  type AiRuntimeStatus,
  type ModelConnectionTestResult,
} from "../../shared/ipc";
import type { DatabaseRuntime } from "../database/database";
import type { CredentialStore } from "../security/credentialStore";
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
  resolveLanguageModel(modelConfigId: string): ResolvedLanguageModel;
  resolveSpeechModel(modelConfigId: string): ResolvedSpeechModel;
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
  let status = aiRuntimeStatusSchema.parse({
    ready: true,
    configuredProviderCount: 0,
    modelCallsEnabled: false,
  });

  const reload = async (): Promise<void> => {
    const providers: Record<string, RegistryProvider> = {};

    for (const config of database.listProviderConfigs().providerConfigs) {
      if (!config.enabled) continue;
      const definition = getProviderDefinition(
        config.providerType,
        providerDefinitions,
      );
      if (
        config.credentialRef === null &&
        definition.metadata.credentialMode === "required"
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
      } catch {
        // An invalid or unavailable config remains persisted but is not exposed as callable.
      }
    }

    registry = createProviderRegistry(providers);
    registeredProviderIds = new Set(Object.keys(providers));
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

    return {
      model: speech.createModel(
        registry,
        `${providerConfig.id}:${modelConfig.modelId}` as `${string}:${string}`,
      ),
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
    resolveLanguageModel,
    resolveSpeechModel,
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
          await definition.speechModel.testConnection(
            resolveSpeechModel(modelConfigId).model,
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
