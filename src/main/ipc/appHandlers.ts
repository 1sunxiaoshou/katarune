import { diagnosticIpcMain } from "../diagnostics/ipc";
import { app } from "electron";
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
  diagnosticIpcMain.handle(IPC_CHANNELS.getAppInfo, () =>
    appInfoSchema.parse({
      name: app.getName(),
      version: app.getVersion(),
      platform: process.platform,
      electronVersion: process.versions.electron,
      nodeVersion: process.versions.node,
    }),
  );
  diagnosticIpcMain.handle(IPC_CHANNELS.getDatabaseStatus, () => database.getStatus());
  diagnosticIpcMain.handle(IPC_CHANNELS.getAiRuntimeStatus, () => aiRuntime.getStatus());
  diagnosticIpcMain.handle(IPC_CHANNELS.getAppState, () =>
    appStateSchema.parse(database.getAppState()),
  );
  diagnosticIpcMain.handle(IPC_CHANNELS.setActiveCharacter, (_event, value: unknown) => {
    const { characterId } = setActiveCharacterRequestSchema.parse(value);
    return appStateSchema.parse(database.setActiveCharacter(characterId));
  });
  diagnosticIpcMain.handle(IPC_CHANNELS.getAppSettings, () =>
    appSettingsSchema.parse(database.getAppSettings()),
  );
  diagnosticIpcMain.handle(IPC_CHANNELS.updateAppSettings, (_event, value: unknown) => {
    const request = updateAppSettingsRequestSchema.parse(value);
    if (request.defaultLanguageModelConfigId != null) {
      try {
        aiRuntime.resolveLanguageModel(request.defaultLanguageModelConfigId);
      } catch {
        throw new Error("只能选择当前可用的语言模型作为默认模型。");
      }
    }
    if (request.defaultSpeechModelConfigId != null) {
      try { aiRuntime.resolveSpeechModel(request.defaultSpeechModelConfigId); }
      catch { throw new Error("只能选择当前可用的语音合成模型作为默认模型。"); }
    }
    return appSettingsSchema.parse(database.updateAppSettings(request));
  });
}
