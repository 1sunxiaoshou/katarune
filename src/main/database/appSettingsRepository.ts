import { eq } from "drizzle-orm";
import { agentToolOverridesSchema, defaultAgentToolEnabled } from "../../shared/agentToolSettings";
import {
  appSettingsSchema,
  type AppSettings,
  type ModelConfig,
} from "../../shared/ipc";
import { appSettings } from "./schema";
import type {
  AppSettingsRepository,
  KataruneDatabase,
} from "./types";

export function createAppSettingsRepository(
  database: KataruneDatabase,
  fetchModelConfig: (id: string) => ModelConfig,
): AppSettingsRepository {
  const getAgentToolOverrides = () => {
    const row = database.select({ overrides: appSettings.agentToolOverrides }).from(appSettings).where(eq(appSettings.id, 1)).get();
    if (!row) throw new Error("Application settings were not initialized.");
    return agentToolOverridesSchema.parse(row.overrides ?? {});
  };
  const getAppSettings = (): AppSettings => {
    const settings = database
      .select()
      .from(appSettings)
      .where(eq(appSettings.id, 1))
      .get();
    if (settings === undefined) {
      throw new Error("Application settings were not initialized.");
    }
    return appSettingsSchema.parse({
      defaultLanguageModelConfigId: settings.defaultLanguageModelConfigId,
      defaultSpeechModelConfigId: settings.defaultSpeechModelConfigId,
      defaultSpeechVoice: settings.defaultSpeechModelConfigId === null ? null : settings.defaultSpeechVoice,
      // ASR is bundled; legacy null settings resolve to the installed default.
      defaultAsrModel: settings.defaultAsrModel ?? "sensevoice-small-int8",
    });
  };

  return {
    getAppSettings,
    getAgentToolOverrides,
    setAgentToolEnabled: ({ id, scope, enabled }) => {
      database.transaction(tx => {
        const row = tx.select({ overrides: appSettings.agentToolOverrides }).from(appSettings).where(eq(appSettings.id, 1)).get();
        if (!row) throw new Error("Application settings were not initialized.");
        const overrides = agentToolOverridesSchema.parse(row.overrides ?? {});
        const scene = { ...overrides[scope] };
        if (enabled === defaultAgentToolEnabled(scope, id)) delete scene[id];
        else scene[id] = enabled;
        tx.update(appSettings).set({
          agentToolOverrides: agentToolOverridesSchema.parse({ ...overrides, [scope]: scene }),
        }).where(eq(appSettings.id, 1)).run();
      });
    },
    updateAppSettings: (request) => {
      const current = getAppSettings();
      const updates = { ...request };
      if (request.defaultAsrModel === null) updates.defaultAsrModel = "sensevoice-small-int8";
      if (request.defaultSpeechModelConfigId !== undefined && request.defaultSpeechModelConfigId !== current.defaultSpeechModelConfigId
        && request.defaultSpeechVoice === undefined) updates.defaultSpeechVoice = null;
      if ((request.defaultSpeechModelConfigId ?? current.defaultSpeechModelConfigId) === null && request.defaultSpeechVoice != null) {
        throw new Error("请先选择默认语音合成模型。");
      }
      if (request.defaultSpeechModelConfigId === null) updates.defaultSpeechVoice = null;
      const { defaultLanguageModelConfigId, defaultSpeechModelConfigId } = request;
      if (defaultLanguageModelConfigId != null) {
        const model = fetchModelConfig(defaultLanguageModelConfigId);
        if (model.modelType !== "languageModel") {
          throw new Error("应用默认模型必须是语言模型。");
        }
      }
      if (defaultSpeechModelConfigId != null) {
        const model = fetchModelConfig(defaultSpeechModelConfigId);
        if (model.modelType !== "speechModel") {
          throw new Error("默认语音合成模型必须是语音生成模型。");
        }
      }
      database
        .update(appSettings)
        .set({ ...updates, updatedAt: new Date() })
        .where(eq(appSettings.id, 1))
        .run();
      return getAppSettings();
    },
  };
}
