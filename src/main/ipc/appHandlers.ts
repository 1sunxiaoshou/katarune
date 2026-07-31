import { app, ipcMain } from "electron";
import {
  appInfoSchema,
  appSettingsSchema,
  appStateSchema,
  IPC_CHANNELS,
  setActiveCharacterRequestSchema,
  updateAppSettingsRequestSchema,
} from "../../shared/ipc";
import type { AiRuntime } from "../ai/runtime";
import type { DatabaseRuntime } from "../database/database";

export function registerAppHandlers(
  database: DatabaseRuntime,
  aiRuntime: AiRuntime,
): void {
  ipcMain.handle(IPC_CHANNELS.getAppInfo, () =>
    appInfoSchema.parse({
      name: app.getName(),
      version: app.getVersion(),
      platform: process.platform,
      electronVersion: process.versions.electron,
      nodeVersion: process.versions.node,
    }),
  );
  ipcMain.handle(IPC_CHANNELS.getDatabaseStatus, () => database.getStatus());
  ipcMain.handle(IPC_CHANNELS.getAiRuntimeStatus, () => aiRuntime.getStatus());
  ipcMain.handle(IPC_CHANNELS.getAppState, () =>
    appStateSchema.parse(database.getAppState()),
  );
  ipcMain.handle(IPC_CHANNELS.setActiveCharacter, (_event, value: unknown) => {
    const { characterId } = setActiveCharacterRequestSchema.parse(value);
    return appStateSchema.parse(database.setActiveCharacter(characterId));
  });
  ipcMain.handle(IPC_CHANNELS.getAppSettings, () =>
    appSettingsSchema.parse(database.getAppSettings()),
  );
  ipcMain.handle(IPC_CHANNELS.updateAppSettings, (_event, value: unknown) => {
    const request = updateAppSettingsRequestSchema.parse(value);
    if (request.defaultLanguageModelConfigId !== null) {
      try {
        aiRuntime.resolveLanguageModel(request.defaultLanguageModelConfigId);
      } catch {
        throw new Error("只能选择当前可用的语言模型作为默认模型。");
      }
    }
    return appSettingsSchema.parse(database.updateAppSettings(request));
  });
}
