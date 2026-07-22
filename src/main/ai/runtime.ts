import {
  createProviderRegistry,
  defaultSettingsMiddleware,
  generateText,
  wrapLanguageModel,
  type LanguageModel,
} from "ai";
import {
  aiRuntimeStatusSchema,
  modelConnectionTestResultSchema,
  type AiRuntimeStatus,
  type ModelConnectionTestResult,
} from "../../shared/ipc";
import type { DatabaseRuntime } from "../database/database";
import type { CredentialStore } from "../security/credentialStore";
import { createConfiguredProvider, type RegistryProvider } from "./providerFactory";

type ProviderRegistry = ReturnType<
  typeof createProviderRegistry<Record<string, RegistryProvider>, ":">
>;
type ConnectionProbe = (model: LanguageModel) => Promise<void>;

export type AiRuntimeDatabase = Pick<
  DatabaseRuntime,
  "listProviderConfigs" | "listModelConfigs" | "fetchProviderConfig" | "fetchModelConfig"
>;

export interface AiRuntime {
  readonly registry: ProviderRegistry;
  getStatus(): AiRuntimeStatus;
  reload(): Promise<void>;
  resolveLanguageModel(modelConfigId: string): LanguageModel;
  testConnection(modelConfigId: string): Promise<ModelConnectionTestResult>;
}

interface CreateAiRuntimeOptions {
  readonly database: AiRuntimeDatabase;
  readonly credentialStore: CredentialStore;
  readonly connectionProbe?: ConnectionProbe;
}

const defaultConnectionProbe: ConnectionProbe = async (model) => {
  await generateText({
    model,
    prompt: "Reply with OK.",
    maxOutputTokens: 8,
    maxRetries: 0,
    timeout: 15_000,
  });
};

export async function createAiRuntime({
  database,
  credentialStore,
  connectionProbe = defaultConnectionProbe,
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
      if (config.credentialRef === null && config.providerType !== "openai-compatible") continue;

      try {
        const apiKey =
          config.credentialRef === null
            ? undefined
            : await credentialStore.resolve(config.credentialRef);
        providers[config.id] = createConfiguredProvider(config, apiKey);
      } catch {
        // An invalid or unavailable config remains persisted but is not exposed as callable.
      }
    }

    registry = createProviderRegistry(providers);
    registeredProviderIds = new Set(Object.keys(providers));
    const modelCallsEnabled = database.listModelConfigs().modelConfigs.some((modelConfig) => {
      if (!modelConfig.enabled || modelConfig.modelType !== "languageModel") return false;
      const providerConfig = database.fetchProviderConfig(modelConfig.providerConfigId);
      return providerConfig.enabled && registeredProviderIds.has(providerConfig.id);
    });
    status = aiRuntimeStatusSchema.parse({
      ready: true,
      configuredProviderCount: registeredProviderIds.size,
      modelCallsEnabled,
    });
  };

  const resolveLanguageModel = (modelConfigId: string): LanguageModel => {
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

    const model = registry.languageModel(
      `${providerConfig.id}:${modelConfig.modelId}` as `${string}:${string}`,
    );
    return modelConfig.settings === null
      ? model
      : wrapLanguageModel({
          model,
          middleware: defaultSettingsMiddleware({ settings: modelConfig.settings }),
        });
  };

  const runtime: AiRuntime = {
    get registry() {
      return registry;
    },
    getStatus: () => status,
    reload,
    resolveLanguageModel,
    testConnection: async (modelConfigId) => {
      const startedAt = Date.now();
      try {
        await connectionProbe(resolveLanguageModel(modelConfigId));
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
