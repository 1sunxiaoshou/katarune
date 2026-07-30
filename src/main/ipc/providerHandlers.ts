import { ipcMain } from "electron";
import {
  createModelConfigRequestSchema,
  createProviderConfigRequestSchema,
  discoveredModelListSchema,
  IPC_CHANNELS,
  modelConfigIdRequestSchema,
  operationSuccessSchema,
  providerConfigIdRequestSchema,
  replaceProviderCredentialRequestSchema,
  updateModelConfigRequestSchema,
  updateProviderConfigRequestSchema,
} from "../../shared/ipc";
import { discoverProviderModels } from "../ai/modelDiscovery";
import type { AiRuntime } from "../ai/runtime";
import type { DatabaseRuntime } from "../database/database";
import type { CredentialStore } from "../security/credentialStore";

export function registerProviderHandlers(
  database: DatabaseRuntime,
  aiRuntime: AiRuntime,
  credentialStore: CredentialStore,
): void {
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
  ipcMain.handle(IPC_CHANNELS.createModelConfig, async (_event, value: unknown) => {
    const request = createModelConfigRequestSchema.parse(value);
    const result = database.createModelConfig(request);
    await aiRuntime.reload();
    return result;
  });
  ipcMain.handle(IPC_CHANNELS.fetchModelConfig, (_event, value: unknown) => {
    const { id } = modelConfigIdRequestSchema.parse(value);
    return database.fetchModelConfig(id);
  });
  ipcMain.handle(IPC_CHANNELS.updateModelConfig, async (_event, value: unknown) => {
    const request = updateModelConfigRequestSchema.parse(value);
    const result = database.updateModelConfig(request);
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
    const { id } = providerConfigIdRequestSchema.parse(value);
    const provider = database.fetchProviderConfig(id);
    const apiKey =
      provider.credentialRef === null
        ? undefined
        : await credentialStore.resolve(provider.credentialRef);
    return discoveredModelListSchema.parse(
      await discoverProviderModels(provider, apiKey),
    );
  });
  ipcMain.handle(IPC_CHANNELS.testModelConnection, (_event, value: unknown) => {
    const { id } = modelConfigIdRequestSchema.parse(value);
    return aiRuntime.testConnection(id);
  });
}
