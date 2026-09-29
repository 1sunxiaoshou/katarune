import { ipcMain } from "electron";
import {
  availableModelListSchema,
  createModelConfigRequestSchema,
  createProviderConfigRequestSchema,
  discoveredModelListSchema,
  discoverProviderModelsRequestSchema,
  IPC_CHANNELS,
  modelConfigIdRequestSchema,
  operationSuccessSchema,
  providerConfigIdRequestSchema,
  replaceProviderCredentialRequestSchema,
  updateModelConfigRequestSchema,
  updateProviderConfigRequestSchema,
  type ProviderConfig,
} from "../../shared/ipc";
import { discoverProviderModels } from "../ai/modelDiscovery";
import { importDiscoveredModels } from "../ai/importDiscoveredModels";
import {
  inspectModelForPersistence,
} from "../ai/modelInspection";
import { getProviderDefinition } from "../ai/providerDefinitions";
import type { AiRuntime } from "../ai/runtime";
import type { DatabaseRuntime } from "../database/database";
import type { CredentialStore } from "../security/credentialStore";

export function registerProviderHandlers(
  database: DatabaseRuntime,
  aiRuntime: AiRuntime,
  credentialStore: CredentialStore,
): void {
  const resolveApiKey = async (
    provider: ProviderConfig,
  ): Promise<string | undefined> =>
    provider.credentialRef === null
      ? undefined
      : credentialStore.resolve(provider.credentialRef);

  ipcMain.handle(IPC_CHANNELS.listProviderConfigs, () =>
    database.listProviderConfigs(),
  );
  ipcMain.handle(IPC_CHANNELS.createProviderConfig, async (_event, value: unknown) => {
    const request = createProviderConfigRequestSchema.parse(value);
    const result = database.createProviderConfig(request);
    await aiRuntime.reload();
    return result;
  });
  ipcMain.handle(IPC_CHANNELS.fetchProviderConfig, (_event, value: unknown) => {
    const { id } = providerConfigIdRequestSchema.parse(value);
    return database.fetchProviderConfig(id);
  });
  ipcMain.handle(IPC_CHANNELS.updateProviderConfig, async (_event, value: unknown) => {
    const request = updateProviderConfigRequestSchema.parse(value);
    const result = database.updateProviderConfig(request);
    await aiRuntime.reload();
    return result;
  });
  ipcMain.handle(
    IPC_CHANNELS.replaceProviderCredential,
    async (_event, value: unknown) => {
      const { providerConfigId, secret } =
        replaceProviderCredentialRequestSchema.parse(value);
      const previousConfig = database.fetchProviderConfig(providerConfigId);
      const nextReference = await credentialStore.put(secret);

      try {
        const result = database.setProviderCredentialReference(
          providerConfigId,
          nextReference,
        );
        await aiRuntime.reload();

        if (previousConfig.credentialRef !== null) {
          try {
            await credentialStore.delete(previousConfig.credentialRef);
          } catch (error) {
            database.setProviderCredentialReference(
              providerConfigId,
              previousConfig.credentialRef,
            );
            await aiRuntime.reload();
            await credentialStore.delete(nextReference);
            throw error;
          }
        }

        return result;
      } catch (error) {
        if (
          database.fetchProviderConfig(providerConfigId).credentialRef ===
          nextReference
        ) {
          database.setProviderCredentialReference(
            providerConfigId,
            previousConfig.credentialRef,
          );
          await aiRuntime.reload();
        }
        await credentialStore.delete(nextReference);
        throw error;
      }
    },
  );
  ipcMain.handle(IPC_CHANNELS.clearProviderCredential, async (_event, value: unknown) => {
    const { id } = providerConfigIdRequestSchema.parse(value);
    const previousConfig = database.fetchProviderConfig(id);
    if (previousConfig.credentialRef === null) return previousConfig;

    const result = database.setProviderCredentialReference(id, null);
    try {
      await aiRuntime.reload();
      await credentialStore.delete(previousConfig.credentialRef);
      return result;
    } catch (error) {
      database.setProviderCredentialReference(id, previousConfig.credentialRef);
      await aiRuntime.reload();
      throw error;
    }
  });
  ipcMain.handle(IPC_CHANNELS.deleteProviderConfig, async (_event, value: unknown) => {
    const { id } = providerConfigIdRequestSchema.parse(value);
    const credentialRef = database.fetchProviderConfig(id).credentialRef;
    database.deleteProviderConfig(id);
    await aiRuntime.reload();
    if (credentialRef !== null) await credentialStore.delete(credentialRef);
    return operationSuccessSchema.parse({ success: true });
  });
  ipcMain.handle(IPC_CHANNELS.listModelConfigs, () =>
    database.listModelConfigs(),
  );
  ipcMain.handle(IPC_CHANNELS.listAvailableModels, () =>
    availableModelListSchema.parse({
      modelConfigIds: aiRuntime.listAvailableModelConfigIds(),
    }),
  );
  ipcMain.handle(IPC_CHANNELS.createModelConfig, async (_event, value: unknown) => {
    const request = createModelConfigRequestSchema.parse(value);
    const provider = database.fetchProviderConfig(request.providerConfigId);
    const inspected = await inspectModelForPersistence({
      provider,
      definition: getProviderDefinition(provider.providerType),
      apiKey: await resolveApiKey(provider),
      modelId: request.modelId,
      modelTypeHint: request.modelType,
      allowInspectionFallback: true,
    });
    const result = database.createModelConfig({
      ...request,
      modelType: inspected.modelType,
      displayName: request.displayName ?? inspected.suggestedDisplayName,
      metadata: inspected.metadata,
      settings: request.settings ?? inspected.suggestedSettings,
    });
    await aiRuntime.reload();
    return result;
  });
  ipcMain.handle(IPC_CHANNELS.fetchModelConfig, (_event, value: unknown) => {
    const { id } = modelConfigIdRequestSchema.parse(value);
    return database.fetchModelConfig(id);
  });
  ipcMain.handle(IPC_CHANNELS.updateModelConfig, async (_event, value: unknown) => {
    const request = updateModelConfigRequestSchema.parse(value);
    const current = database.fetchModelConfig(request.id);
    const inspected =
      current.modelId === request.modelId &&
      current.modelType === request.modelType
        ? {
            modelType: current.modelType,
            metadata: current.metadata,
            suggestedSettings: null,
          }
        : await (async () => {
            const provider = database.fetchProviderConfig(
              current.providerConfigId,
            );
            return inspectModelForPersistence({
              provider,
              definition: getProviderDefinition(provider.providerType),
              apiKey: await resolveApiKey(provider),
              modelId: request.modelId,
              modelTypeHint: request.modelType,
              allowInspectionFallback: true,
            });
          })();
    const result = database.updateModelConfig({
      ...request,
      modelType: inspected.modelType,
      metadata: inspected.metadata,
      settings: request.settings,
    });
    await aiRuntime.reload();
    return result;
  });
  ipcMain.handle(IPC_CHANNELS.deleteModelConfig, async (_event, value: unknown) => {
    const { id } = modelConfigIdRequestSchema.parse(value);
    database.deleteModelConfig(id);
    await aiRuntime.reload();
    return operationSuccessSchema.parse({ success: true });
  });
  ipcMain.handle(IPC_CHANNELS.discoverProviderModels, async (_event, value: unknown) => {
    const { id, autoAdd } = discoverProviderModelsRequestSchema.parse(value);
    const provider = database.fetchProviderConfig(id);
    const apiKey = await resolveApiKey(provider);
    const discovered = await discoverProviderModels(provider, apiKey);
    const result = autoAdd ? await importDiscoveredModels(database, provider, apiKey, discovered) : discovered;
    if (autoAdd) await aiRuntime.reload();
    return discoveredModelListSchema.parse(result);
  });
  ipcMain.handle(IPC_CHANNELS.refreshModelMetadata, async (_event, value: unknown) => {
    const { id } = modelConfigIdRequestSchema.parse(value);
    const current = database.fetchModelConfig(id);
    const provider = database.fetchProviderConfig(current.providerConfigId);
    const inspected = await inspectModelForPersistence({
      provider,
      definition: getProviderDefinition(provider.providerType),
      apiKey: await resolveApiKey(provider),
      modelId: current.modelId,
      modelTypeHint: current.modelType,
      allowInspectionFallback: false,
    });
    if (inspected.modelType !== current.modelType) {
      throw new Error("供应商返回的模型类别已变化，请编辑模型并确认新类别。");
    }
    const result = database.updateModelConfig({
      id: current.id,
      modelType: current.modelType,
      modelId: current.modelId,
      displayName: current.displayName,
      metadata: inspected.metadata,
      settings: current.settings,
      enabled: current.enabled,
    });
    await aiRuntime.reload();
    return result;
  });
  ipcMain.handle(IPC_CHANNELS.testModelConnection, (_event, value: unknown) => {
    const { id } = modelConfigIdRequestSchema.parse(value);
    return aiRuntime.testConnection(id);
  });
}
