import { eq } from "drizzle-orm";
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
    });
  };

  return {
    getAppSettings,
    updateAppSettings: ({ defaultLanguageModelConfigId }) => {
      if (defaultLanguageModelConfigId !== null) {
        const model = fetchModelConfig(defaultLanguageModelConfigId);
        if (model.modelType !== "languageModel") {
          throw new Error("应用默认模型必须是语言模型。");
        }
      }
      database
        .update(appSettings)
        .set({ defaultLanguageModelConfigId, updatedAt: new Date() })
        .where(eq(appSettings.id, 1))
        .run();
      return getAppSettings();
    },
  };
}
