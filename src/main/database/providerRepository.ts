import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import {
  providerConfigListSchema,
  providerConfigSchema,
  type ProviderConfig,
} from "../../shared/ipc";
import { providerConfigs } from "./schema";
import type {
  DatabaseSettingsValidator,
  KataruneDatabase,
  ProviderRepository,
} from "./types";

export function createProviderRepository(
  database: KataruneDatabase,
  validator: DatabaseSettingsValidator,
): ProviderRepository {
  const fetchProviderConfig = (id: string): ProviderConfig => {
    const providerConfig = database
      .select()
      .from(providerConfigs)
      .where(eq(providerConfigs.id, id))
      .get();

    if (providerConfig === undefined) {
      throw new Error(`Provider config "${id}" was not found.`);
    }

    return providerConfigSchema.parse(providerConfig);
  };

  return {
    listProviderConfigs: () =>
      providerConfigListSchema.parse({
        providerConfigs: database
          .select()
          .from(providerConfigs)
          .orderBy(asc(providerConfigs.createdAt))
          .all(),
      }),
    createProviderConfig: (request) => {
      validator.validateProviderSettings(
        request.providerType,
        request.settings,
      );
      const id = randomUUID();
      const now = new Date();
      database
        .insert(providerConfigs)
        .values({
          id,
          displayName: request.displayName,
          providerType: request.providerType,
          baseUrl: request.baseUrl,
          credentialRef: null,
          settings: request.settings,
          enabled: request.enabled,
          createdAt: now,
          updatedAt: now,
        })
        .run();

      return fetchProviderConfig(id);
    },
    fetchProviderConfig,
    updateProviderConfig: ({ id, ...updates }) => {
      const current = fetchProviderConfig(id);
      validator.validateProviderSettings(
        current.providerType,
        updates.settings,
      );
      const result = database
        .update(providerConfigs)
        .set({ ...updates, updatedAt: new Date() })
        .where(eq(providerConfigs.id, id))
        .run();
      if (result.changes === 0) fetchProviderConfig(id);
      return fetchProviderConfig(id);
    },
    setProviderCredentialReference: (id, credentialRef) => {
      const result = database
        .update(providerConfigs)
        .set({ credentialRef, updatedAt: new Date() })
        .where(eq(providerConfigs.id, id))
        .run();
      if (result.changes === 0) fetchProviderConfig(id);
      return fetchProviderConfig(id);
    },
    deleteProviderConfig: (id) => {
      const result = database
        .delete(providerConfigs)
        .where(eq(providerConfigs.id, id))
        .run();
      if (result.changes === 0) fetchProviderConfig(id);
    },
  };
}
