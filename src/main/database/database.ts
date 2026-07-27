import { randomUUID } from "node:crypto";
import { join } from "node:path";
import BetterSqlite3 from "better-sqlite3";
import { and, asc, count, desc, eq, inArray, ne } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { z } from "zod";
import {
  characterListSchema,
  characterSchema,
  deleteCharacterResultSchema,
  appStateSchema,
  assetSchema,
  databaseStatusSchema,
  initializeThreadResponseSchema,
  modelConfigListSchema,
  modelConfigSchema,
  providerConfigListSchema,
  providerConfigSchema,
  threadListSchema,
  threadMessagesSchema,
  threadMetadataSchema,
  type AppendThreadMessageRequest,
  type AppState,
  type Asset,
  type Character,
  type CharacterList,
  type CreateCharacterRequest,
  type DeleteCharacterResult,
  type DatabaseStatus,
  type CreateProviderConfigRequest,
  type CreateModelConfigRequest,
  type InitializeThreadResponse,
  type ModelConfig,
  type ModelConfigList,
  type ProviderConfig,
  type ProviderConfigList,
  type StoredMessage,
  type ThreadList,
  type ThreadMessages,
  type ThreadMetadata,
  type UpdateCharacterRequest,
  type UpdateProviderConfigRequest,
  type UpdateModelConfigRequest,
} from "../../shared/ipc";
import { loadDefaultCharacterConfig } from "../characters/defaultCharacter";
import {
  appState,
  assets,
  characters,
  messages,
  modelConfigs,
  providerConfigs,
  threads,
} from "./schema";

const VALIDATION_THREAD_ID = "p1-database-validation";

const persistedThreadSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  status: z.enum(["regular", "archived"]),
  characterId: z.string().uuid(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export interface DatabaseRuntime {
  getStatus(): DatabaseStatus;
  getAppState(): AppState;
  setActiveCharacter(characterId: string): AppState;
  listThreads(characterId: string): ThreadList;
  initializeThread(threadId: string, characterId: string): InitializeThreadResponse;
  fetchThread(threadId: string, characterId: string): ThreadMetadata;
  renameThread(threadId: string, characterId: string, title: string): void;
  setThreadStatus(
    threadId: string,
    characterId: string,
    status: "regular" | "archived",
  ): void;
  deleteThread(threadId: string, characterId: string): void;
  loadThreadMessages(threadId: string, characterId: string): ThreadMessages;
  appendThreadMessage(request: AppendThreadMessageRequest): void;
  deleteThreadMessages(
    threadId: string,
    characterId: string,
    messageIds: readonly string[],
  ): void;
  listProviderConfigs(): ProviderConfigList;
  createProviderConfig(request: CreateProviderConfigRequest): ProviderConfig;
  fetchProviderConfig(id: string): ProviderConfig;
  updateProviderConfig(request: UpdateProviderConfigRequest): ProviderConfig;
  setProviderCredentialReference(id: string, credentialRef: string | null): ProviderConfig;
  deleteProviderConfig(id: string): void;
  listModelConfigs(): ModelConfigList;
  createModelConfig(request: CreateModelConfigRequest): ModelConfig;
  fetchModelConfig(id: string): ModelConfig;
  updateModelConfig(request: UpdateModelConfigRequest): ModelConfig;
  deleteModelConfig(id: string): void;
  listCharacters(): CharacterList;
  createCharacter(
    request: CreateCharacterRequest,
    portraitAsset?: ReadyAssetRegistration,
  ): Character;
  deleteCharacter(id: string): DeleteCharacterResult;
  fetchCharacter(id: string): Character;
  updateCharacter(request: UpdateCharacterRequest): Character;
  fetchAsset(id: string): Asset;
  listAssets(): readonly Asset[];
  registerAssetAndSetCharacterPortrait(
    characterId: string,
    asset: ReadyAssetRegistration,
  ): Character;
  markAssetReady(id: string, metadata: AssetMetadata): Asset;
  close(): void;
}

export interface AssetMetadata {
  readonly mimeType: string;
  readonly byteSize: number;
  readonly sha256: string;
  readonly originalName: string;
}

export interface ReadyAssetRegistration extends AssetMetadata {
  readonly id: string;
  readonly storageKey: string;
}

interface OpenDatabaseOptions {
  readonly userDataPath: string;
  readonly appPath: string;
  readonly characterResourcesPath?: string;
}

export function openDatabase({
  userDataPath,
  appPath,
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
    migrate(database, { migrationsFolder: join(appPath, "drizzle") });
    sqlite.pragma("foreign_keys = ON");
    const foreignKeyViolations = sqlite.pragma("foreign_key_check");
    if (!Array.isArray(foreignKeyViolations) || foreignKeyViolations.length > 0) {
      throw new Error("SQLite foreign key validation failed after migration.");
    }
  } catch (error) {
    sqlite.close();
    throw error;
  }

  const defaultCharacterConfig = loadDefaultCharacterConfig(characterResourcesPath);
  const existingCharacterCount = database.select({ value: count() }).from(characters).get()?.value;
  if (existingCharacterCount === undefined) {
    sqlite.close();
    throw new Error("Database validation could not count characters.");
  }
  if (existingCharacterCount === 0) {
    const now = new Date();
    const portraitAssetId = defaultCharacterConfig.character.portrait?.assetId ?? null;
    if (portraitAssetId !== null) {
      database
        .insert(assets)
        .values({
          id: portraitAssetId,
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
        portraitAssetId: defaultCharacterConfig.character.portrait?.assetId ?? null,
        modelConfigId: defaultCharacterConfig.character.modelConfigId,
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
    throw new Error("Database validation could not resolve an active character.");
  }
  database
    .insert(appState)
    .values({ id: 1, activeCharacterId: preferredCharacterId, updatedAt: new Date() })
    .onConflictDoNothing({ target: appState.id })
    .run();

  const existingThread = database.select().from(threads).where(eq(threads.id, VALIDATION_THREAD_ID)).get();
  const validationThreadRestored = existingThread !== undefined;

  if (existingThread === undefined) {
    const now = new Date();
    database.insert(threads).values({
      id: VALIDATION_THREAD_ID,
      characterId: preferredCharacterId,
      title: "P1 database validation",
      createdAt: now,
      updatedAt: now,
    }).run();
  }

  const persistedThread = persistedThreadSchema.parse(
    database.select().from(threads).where(eq(threads.id, VALIDATION_THREAD_ID)).get(),
  );
  const threadCount = database.select({ value: count() }).from(threads).get()?.value;

  if (threadCount === undefined) {
    sqlite.close();
    throw new Error("Database validation could not count persisted threads.");
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

  const fetchThread = (threadId: string, characterId: string): ThreadMetadata => {
    const thread = database
      .select()
      .from(threads)
      .where(and(eq(threads.id, threadId), eq(threads.characterId, characterId)))
      .get();

    if (thread === undefined) {
      throw new Error(`Thread "${threadId}" was not found.`);
    }

    return threadMetadataSchema.parse({
      remoteId: thread.id,
      status: thread.status,
      title: thread.title,
      lastMessageAt: thread.updatedAt,
      characterId: thread.characterId,
    });
  };

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

  const fetchModelConfig = (id: string): ModelConfig => {
    const modelConfig = database.select().from(modelConfigs).where(eq(modelConfigs.id, id)).get();

    if (modelConfig === undefined) {
      throw new Error(`Model config "${id}" was not found.`);
    }

    return modelConfigSchema.parse(modelConfig);
  };

  const fetchCharacter = (id: string): Character => {
    const character = database.select().from(characters).where(eq(characters.id, id)).get();
    if (character === undefined) {
      throw new Error(`Character "${id}" was not found.`);
    }
    return characterSchema.parse(character);
  };

  const fetchAsset = (id: string): Asset => {
    const asset = database
      .select({
        id: assets.id,
        status: assets.status,
        mimeType: assets.mimeType,
        byteSize: assets.byteSize,
        sha256: assets.sha256,
        originalName: assets.originalName,
        createdAt: assets.createdAt,
        updatedAt: assets.updatedAt,
      })
      .from(assets)
      .where(eq(assets.id, id))
      .get();
    if (asset === undefined) {
      throw new Error(`Asset "${id}" was not found.`);
    }
    return assetSchema.parse(asset);
  };

  const getAppState = (): AppState => {
    const state = database.select().from(appState).where(eq(appState.id, 1)).get();
    if (state === undefined) {
      throw new Error("Application state was not initialized.");
    }
    return appStateSchema.parse({ activeCharacter: fetchCharacter(state.activeCharacterId) });
  };

  return {
    getStatus: () => status,
    getAppState,
    setActiveCharacter: (characterId) => {
      fetchCharacter(characterId);
      database
        .update(appState)
        .set({ activeCharacterId: characterId, updatedAt: new Date() })
        .where(eq(appState.id, 1))
        .run();
      return getAppState();
    },
    listThreads: (characterId) =>
      threadListSchema.parse({
        threads: database
          .select()
          .from(threads)
          .where(
            and(
              eq(threads.characterId, characterId),
              ne(threads.id, VALIDATION_THREAD_ID),
            ),
          )
          .orderBy(desc(threads.updatedAt))
          .all()
          .map((thread) => ({
            remoteId: thread.id,
            status: thread.status,
            title: thread.title,
            lastMessageAt: thread.updatedAt,
            characterId: thread.characterId,
          })),
      }),
    initializeThread: (threadId, characterId) => {
      fetchCharacter(characterId);
      const now = new Date();
      database
        .insert(threads)
        .values({
          id: threadId,
          characterId,
          title: "新对话",
          status: "regular",
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing({ target: threads.id })
        .run();

      fetchThread(threadId, characterId);
      return initializeThreadResponseSchema.parse({ remoteId: threadId });
    },
    fetchThread,
    renameThread: (threadId, characterId, title) => {
      const result = database
        .update(threads)
        .set({ title, updatedAt: new Date() })
        .where(and(eq(threads.id, threadId), eq(threads.characterId, characterId)))
        .run();
      if (result.changes === 0) fetchThread(threadId, characterId);
    },
    setThreadStatus: (threadId, characterId, threadStatus) => {
      const result = database
        .update(threads)
        .set({ status: threadStatus, updatedAt: new Date() })
        .where(and(eq(threads.id, threadId), eq(threads.characterId, characterId)))
        .run();
      if (result.changes === 0) fetchThread(threadId, characterId);
    },
    deleteThread: (threadId, characterId) => {
      fetchThread(threadId, characterId);
      database
        .delete(threads)
        .where(and(eq(threads.id, threadId), eq(threads.characterId, characterId)))
        .run();
    },
    loadThreadMessages: (threadId, characterId) => {
      fetchThread(threadId, characterId);
      return threadMessagesSchema.parse({
        messages: database
          .select({
            id: messages.id,
            parent_id: messages.parentId,
            format: messages.format,
            content: messages.content,
          })
          .from(messages)
          .where(eq(messages.threadId, threadId))
          .orderBy(asc(messages.createdAt))
          .all(),
      });
    },
    appendThreadMessage: ({ threadId, characterId, message }) => {
      fetchThread(threadId, characterId);
      database.transaction((transaction) => {
        const existingMessage = transaction
          .select({ threadId: messages.threadId })
          .from(messages)
          .where(eq(messages.id, message.id))
          .get();
        if (existingMessage !== undefined && existingMessage.threadId !== threadId) {
          throw new Error(`Message "${message.id}" already belongs to another thread.`);
        }

        const now = new Date();
        transaction
          .insert(messages)
          .values({
            id: message.id,
            threadId,
            parentId: message.parent_id,
            format: message.format,
            content: message.content as StoredMessage["content"],
            createdAt: now,
          })
          .onConflictDoUpdate({
            target: messages.id,
            set: {
              parentId: message.parent_id,
              format: message.format,
              content: message.content as StoredMessage["content"],
            },
          })
          .run();
        const updatedThread = transaction
          .update(threads)
          .set({ updatedAt: now })
          .where(and(eq(threads.id, threadId), eq(threads.characterId, characterId)))
          .run();
        if (updatedThread.changes === 0) {
          throw new Error(`Thread "${threadId}" was not found while appending a message.`);
        }
      });
    },
    deleteThreadMessages: (threadId, characterId, messageIds) => {
      fetchThread(threadId, characterId);
      if (messageIds.length === 0) return;
      database
        .delete(messages)
        .where(and(eq(messages.threadId, threadId), inArray(messages.id, messageIds)))
        .run();
    },
    listProviderConfigs: () =>
      providerConfigListSchema.parse({
        providerConfigs: database
          .select()
          .from(providerConfigs)
          .orderBy(asc(providerConfigs.createdAt))
          .all(),
      }),
    createProviderConfig: (request) => {
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
      const result = database.delete(providerConfigs).where(eq(providerConfigs.id, id)).run();
      if (result.changes === 0) fetchProviderConfig(id);
    },
    listModelConfigs: () =>
      modelConfigListSchema.parse({
        modelConfigs: database.select().from(modelConfigs).orderBy(asc(modelConfigs.createdAt)).all(),
      }),
    createModelConfig: (request) => {
      fetchProviderConfig(request.providerConfigId);
      const existingConfig = database
        .select({ id: modelConfigs.id })
        .from(modelConfigs)
        .where(
          and(
            eq(modelConfigs.providerConfigId, request.providerConfigId),
            eq(modelConfigs.modelId, request.modelId),
          ),
        )
        .get();
      if (existingConfig !== undefined) {
        throw new Error(`Model "${request.modelId}" already exists for this Provider config.`);
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
      const duplicate = database
        .select({ id: modelConfigs.id })
        .from(modelConfigs)
        .where(
          and(
            eq(modelConfigs.providerConfigId, current.providerConfigId),
            eq(modelConfigs.modelId, updates.modelId),
            ne(modelConfigs.id, id),
          ),
        )
        .get();
      if (duplicate !== undefined) {
        throw new Error(`Model "${updates.modelId}" already exists for this Provider config.`);
      }

      database
        .update(modelConfigs)
        .set({ ...updates, updatedAt: new Date() })
        .where(eq(modelConfigs.id, id))
        .run();
      return fetchModelConfig(id);
    },
    deleteModelConfig: (id) => {
      const result = database.delete(modelConfigs).where(eq(modelConfigs.id, id)).run();
      if (result.changes === 0) fetchModelConfig(id);
    },
    listCharacters: () =>
      characterListSchema.parse({
        characters: database
          .select()
          .from(characters)
          .orderBy(desc(characters.createdAt), desc(characters.id))
          .all(),
      }),
    createCharacter: ({ name, modelConfigId, systemPrompt }, portraitAsset) => {
      const id = randomUUID();
      const latestCharacter = database
        .select({ createdAt: characters.createdAt })
        .from(characters)
        .orderBy(desc(characters.createdAt), desc(characters.id))
        .get();
      const now = new Date(
        Math.max(Date.now(), (latestCharacter?.createdAt.getTime() ?? 0) + 1),
      );
      database.transaction((transaction) => {
        if (portraitAsset !== undefined) {
          transaction
            .insert(assets)
            .values({
              ...portraitAsset,
              status: "ready",
              createdAt: now,
              updatedAt: now,
            })
            .run();
        }
        transaction
          .insert(characters)
          .values({
            id,
            name,
            portraitAssetId: portraitAsset?.id ?? null,
            modelConfigId,
            systemPrompt,
            createdAt: now,
            updatedAt: now,
          })
          .run();
      });
      return fetchCharacter(id);
    },
    deleteCharacter: (id) =>
      database.transaction((transaction) => {
        const orderedCharacters = transaction
          .select()
          .from(characters)
          .orderBy(desc(characters.createdAt), desc(characters.id))
          .all();
        const deletedIndex = orderedCharacters.findIndex((character) => character.id === id);
        if (deletedIndex === -1) {
          throw new Error(`Character "${id}" was not found.`);
        }
        if (orderedCharacters.length <= 1) {
          throw new Error("至少需要保留一个角色。");
        }

        const replacement =
          orderedCharacters[deletedIndex + 1] ?? orderedCharacters[deletedIndex - 1];
        if (replacement === undefined) {
          throw new Error("无法确定替代角色。");
        }

        const state = transaction.select().from(appState).where(eq(appState.id, 1)).get();
        if (state === undefined) {
          throw new Error("Application state was not initialized.");
        }
        const activeCharacterId =
          state.activeCharacterId === id ? replacement.id : state.activeCharacterId;
        if (state.activeCharacterId === id) {
          transaction
            .update(appState)
            .set({ activeCharacterId, updatedAt: new Date() })
            .where(eq(appState.id, 1))
            .run();
        }

        const deletedThreadCount =
          transaction
            .select({ value: count() })
            .from(threads)
            .where(
              and(
                eq(threads.characterId, id),
                ne(threads.id, VALIDATION_THREAD_ID),
              ),
            )
            .get()?.value ?? 0;
        transaction
          .delete(threads)
          .where(eq(threads.characterId, id))
          .run();
        const deletedCharacter = transaction
          .delete(characters)
          .where(eq(characters.id, id))
          .run();
        if (deletedCharacter.changes !== 1) {
          throw new Error(`Character "${id}" was not found.`);
        }

        const activeCharacter = transaction
          .select()
          .from(characters)
          .where(eq(characters.id, activeCharacterId))
          .get();
        if (activeCharacter === undefined) {
          throw new Error("Application state references a missing character.");
        }

        return deleteCharacterResultSchema.parse({
          deletedCharacterId: id,
          deletedThreadCount,
          replacementCharacter: replacement,
          activeCharacter,
        });
      }),
    fetchCharacter,
    updateCharacter: ({ id, name, modelConfigId, systemPrompt }) => {
      const updates: {
        name?: string;
        modelConfigId?: string | null;
        systemPrompt?: string;
        updatedAt: Date;
      } = { updatedAt: new Date() };
      if (name !== undefined) updates.name = name;
      if (modelConfigId !== undefined) updates.modelConfigId = modelConfigId;
      if (systemPrompt !== undefined) updates.systemPrompt = systemPrompt;

      const result = database
        .update(characters)
        .set(updates)
        .where(eq(characters.id, id))
        .run();
      if (result.changes === 0) fetchCharacter(id);
      return fetchCharacter(id);
    },
    fetchAsset,
    listAssets: () =>
      database
        .select({ id: assets.id })
        .from(assets)
        .orderBy(asc(assets.createdAt))
        .all()
        .map(({ id }) => fetchAsset(id)),
    registerAssetAndSetCharacterPortrait: (characterId, asset) => {
      fetchCharacter(characterId);
      const now = new Date();
      database.transaction((transaction) => {
        transaction
          .insert(assets)
          .values({
            ...asset,
            status: "ready",
            createdAt: now,
            updatedAt: now,
          })
          .run();
        const result = transaction
          .update(characters)
          .set({ portraitAssetId: asset.id, updatedAt: now })
          .where(eq(characters.id, characterId))
          .run();
        if (result.changes !== 1) {
          throw new Error(`Character "${characterId}" was not found.`);
        }
      });
      return fetchCharacter(characterId);
    },
    markAssetReady: (id, metadata) => {
      const result = database
        .update(assets)
        .set({ ...metadata, status: "ready", updatedAt: new Date() })
        .where(eq(assets.id, id))
        .run();
      if (result.changes === 0) fetchAsset(id);
      return fetchAsset(id);
    },
    close: () => sqlite.close(),
  };
}
