import { join } from "node:path";
import BetterSqlite3 from "better-sqlite3";
import { asc, count, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { z } from "zod";
import {
  databaseStatusSchema,
  type DatabaseStatus,
} from "../../shared/ipc";
import { loadDefaultCharacterConfig } from "../characters/defaultCharacter";
import { createAppSettingsRepository } from "./appSettingsRepository";
import { createAppStateRepository } from "./appStateRepository";
import { createAssetRepository } from "./assetRepository";
import { createCharacterRepository } from "./characterRepository";
import { VALIDATION_THREAD_ID } from "./constants";
import { createModelRepository } from "./modelRepository";
import { reconcileAttachmentMigrationHistory } from "./migrationHistory";
import { createProviderRepository } from "./providerRepository";
import { appSettings, appState, assets, characters, threads } from "./schema";
import { createThreadRepository } from "./threadRepository";
import type {
  DatabaseRuntime,
  DatabaseConfigValidator,
} from "./types";

export type {
  AssetMetadata,
  DatabaseRuntime,
  DatabaseConfigValidator,
  ReadyAssetRegistration,
} from "./types";

const persistedThreadSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  status: z.enum(["regular", "archived"]),
  characterId: z.string().uuid(),
  lastMessageAt: z.date().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

interface OpenDatabaseOptions {
  readonly userDataPath: string;
  readonly appPath: string;
  readonly configValidator: DatabaseConfigValidator;
  readonly characterResourcesPath?: string;
}

export function openDatabase({
  userDataPath,
  appPath,
  configValidator,
  characterResourcesPath = join(appPath, "resources", "characters"),
}: OpenDatabaseOptions): DatabaseRuntime {
  const sqlite = new BetterSqlite3(join(userDataPath, "katarune.sqlite"));

  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("busy_timeout = 5000");

  const database = drizzle(sqlite);
  // Migration 0005 rebuilds a referenced table to converge the old local and merged histories.
  // SQLite requires enforcement to be disabled before Drizzle opens its migration transaction.
  sqlite.pragma("foreign_keys = OFF");
  try {
    reconcileAttachmentMigrationHistory(sqlite, join(appPath, "drizzle"));
    migrate(database, { migrationsFolder: join(appPath, "drizzle") });
    sqlite.pragma("foreign_keys = ON");
    const foreignKeyViolations = sqlite.pragma("foreign_key_check");
    if (
      !Array.isArray(foreignKeyViolations) ||
      foreignKeyViolations.length > 0
    ) {
      throw new Error(
        "SQLite foreign key validation failed after migration.",
      );
    }
  } catch (error) {
    sqlite.close();
    throw error;
  }

  const defaultCharacterConfig = loadDefaultCharacterConfig(
    characterResourcesPath,
  );
  const existingCharacterCount = database
    .select({ value: count() })
    .from(characters)
    .get()?.value;
  if (existingCharacterCount === undefined) {
    sqlite.close();
    throw new Error("Database validation could not count characters.");
  }
  if (existingCharacterCount === 0) {
    const now = new Date();
    const portraitAssetId =
      defaultCharacterConfig.character.portrait?.assetId ?? null;
    if (portraitAssetId !== null) {
      database
        .insert(assets)
        .values({
          id: portraitAssetId,
          kind: "character_portrait",
          storageKey: portraitAssetId,
          status: "missing",
          mimeType: null,
          byteSize: null,
          sha256: null,
          originalName: null,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing({ target: assets.id })
        .run();
    }
    database
      .insert(characters)
      .values({
        id: defaultCharacterConfig.character.id,
        name: defaultCharacterConfig.character.name,
        portraitAssetId:
          defaultCharacterConfig.character.portrait?.assetId ?? null,
        modelConfigId: defaultCharacterConfig.character.modelConfigId,
        speechModelConfigId: null,
        speechVoice: null,
        systemPrompt: defaultCharacterConfig.character.systemPrompt,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }

  const preferredCharacterId =
    database
      .select({ id: characters.id })
      .from(characters)
      .where(eq(characters.id, defaultCharacterConfig.character.id))
      .get()?.id ??
    database
      .select({ id: characters.id })
      .from(characters)
      .orderBy(asc(characters.createdAt), asc(characters.id))
      .get()?.id;
  if (preferredCharacterId === undefined) {
    sqlite.close();
    throw new Error(
      "Database validation could not resolve an active character.",
    );
  }
  database
    .insert(appSettings)
    .values({
      id: 1,
      defaultLanguageModelConfigId: null,
      updatedAt: new Date(),
    })
    .onConflictDoNothing({ target: appSettings.id })
    .run();
  database
    .insert(appState)
    .values({
      id: 1,
      activeCharacterId: preferredCharacterId,
      updatedAt: new Date(),
    })
    .onConflictDoNothing({ target: appState.id })
    .run();

  const existingThread = database
    .select()
    .from(threads)
    .where(eq(threads.id, VALIDATION_THREAD_ID))
    .get();
  const validationThreadRestored = existingThread !== undefined;

  if (existingThread === undefined) {
    const now = new Date();
    database
      .insert(threads)
      .values({
        id: VALIDATION_THREAD_ID,
        characterId: preferredCharacterId,
        title: "P1 database validation",
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }

  const persistedThread = persistedThreadSchema.parse(
    database
      .select()
      .from(threads)
      .where(eq(threads.id, VALIDATION_THREAD_ID))
      .get(),
  );
  const threadCount = database
    .select({ value: count() })
    .from(threads)
    .get()?.value;

  if (threadCount === undefined) {
    sqlite.close();
    throw new Error(
      "Database validation could not count persisted threads.",
    );
  }

  const status: DatabaseStatus = Object.freeze(
    databaseStatusSchema.parse({
      ready: true,
      journalMode: "wal",
      threadCount,
      validationThreadId: persistedThread.id,
      validationThreadRestored,
    }),
  );

  const characterRepository = createCharacterRepository(database);
  const appStateRepository = createAppStateRepository(
    database,
    characterRepository.fetchCharacter,
  );
  const threadRepository = createThreadRepository(
    database,
    characterRepository.fetchCharacter,
  );
  const providerRepository = createProviderRepository(
    database,
    configValidator,
  );
  const modelRepository = createModelRepository(
    database,
    configValidator,
    providerRepository.fetchProviderConfig,
  );
  const appSettingsRepository = createAppSettingsRepository(
    database,
    modelRepository.fetchModelConfig,
  );
  const assetRepository = createAssetRepository(database);

  return {
    getStatus: () => status,
    ...appStateRepository,
    ...appSettingsRepository,
    ...threadRepository,
    ...providerRepository,
    ...modelRepository,
    ...characterRepository,
    ...assetRepository,
    close: () => sqlite.close(),
  };
}
