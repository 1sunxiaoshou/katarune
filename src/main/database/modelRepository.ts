import { randomUUID } from "node:crypto";
import { and, asc, eq, ne } from "drizzle-orm";
import {
  modelConfigListSchema,
  modelConfigSchema,
  type ModelConfig,
  type ProviderConfig,
} from "../../shared/ipc";
import { modelConfigs } from "./schema";
import type {
  DatabaseSettingsValidator,
  KataruneDatabase,
  ModelRepository,
} from "./types";

export function createModelRepository(
  database: KataruneDatabase,
  validator: DatabaseSettingsValidator,
  fetchProviderConfig: (id: string) => ProviderConfig,
): ModelRepository {
  const fetchModelConfig = (id: string): ModelConfig => {
    const modelConfig = database
      .select()
      .from(modelConfigs)
      .where(eq(modelConfigs.id, id))
      .get();

    if (modelConfig === undefined) {
      throw new Error(`Model config "${id}" was not found.`);
    }

    return modelConfigSchema.parse(modelConfig);
  };

  return {
    listModelConfigs: () =>
      modelConfigListSchema.parse({
        modelConfigs: database
          .select()
          .from(modelConfigs)
          .orderBy(asc(modelConfigs.createdAt))
          .all(),
      }),
    createModelConfig: (request) => {
      const provider = fetchProviderConfig(request.providerConfigId);
      validator.validateModelSettings(
        provider.providerType,
        request.modelType,
        request.settings,
      );
      const existingConfig = database
        .select({ id: modelConfigs.id })
        .from(modelConfigs)
        .where(
          and(
            eq(
              modelConfigs.providerConfigId,
              request.providerConfigId,
            ),
            eq(modelConfigs.modelId, request.modelId),
          ),
        )
        .get();
      if (existingConfig !== undefined) {
        throw new Error(
          `Model "${request.modelId}" already exists for this Provider config.`,
        );
      }

      const id = randomUUID();
      const now = new Date();
      database
        .insert(modelConfigs)
        .values({
          id,
          providerConfigId: request.providerConfigId,
          modelType: request.modelType,
          modelId: request.modelId,
          displayName: request.displayName,
          settings: request.settings,
          enabled: request.enabled,
          createdAt: now,
          updatedAt: now,
        })
        .run();

      return fetchModelConfig(id);
    },
    fetchModelConfig,
    updateModelConfig: ({ id, ...updates }) => {
      const current = fetchModelConfig(id);
      const provider = fetchProviderConfig(current.providerConfigId);
      validator.validateModelSettings(
        provider.providerType,
        updates.modelType,
        updates.settings,
      );
      const duplicate = database
        .select({ id: modelConfigs.id })
        .from(modelConfigs)
        .where(
          and(
            eq(
              modelConfigs.providerConfigId,
              current.providerConfigId,
            ),
            eq(modelConfigs.modelId, updates.modelId),
            ne(modelConfigs.id, id),
          ),
        )
        .get();
      if (duplicate !== undefined) {
        throw new Error(
          `Model "${updates.modelId}" already exists for this Provider config.`,
        );
      }

      database
        .update(modelConfigs)
        .set({ ...updates, updatedAt: new Date() })
        .where(eq(modelConfigs.id, id))
        .run();
      return fetchModelConfig(id);
    },
    deleteModelConfig: (id) => {
      const result = database
        .delete(modelConfigs)
        .where(eq(modelConfigs.id, id))
        .run();
      if (result.changes === 0) fetchModelConfig(id);
    },
  };
}
