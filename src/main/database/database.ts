import { randomUUID } from "node:crypto";
import { join } from "node:path";
import BetterSqlite3 from "better-sqlite3";
import { and, asc, count, desc, eq, inArray, ne } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { z } from "zod";
import {
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
  type UpdateProviderConfigRequest,
  type UpdateModelConfigRequest,
} from "../../shared/ipc";
import { messages, modelConfigs, providerConfigs, threads } from "./schema";

const VALIDATION_THREAD_ID = "p1-database-validation";

const persistedThreadSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  status: z.enum(["regular", "archived"]),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export interface DatabaseRuntime {
  getStatus(): DatabaseStatus;
  listThreads(): ThreadList;
  initializeThread(threadId: string): InitializeThreadResponse;
  fetchThread(threadId: string): ThreadMetadata;
  renameThread(threadId: string, title: string): void;
  setThreadStatus(threadId: string, status: "regular" | "archived"): void;
  deleteThread(threadId: string): void;
  loadThreadMessages(threadId: string): ThreadMessages;
  appendThreadMessage(request: AppendThreadMessageRequest): void;
  deleteThreadMessages(threadId: string, messageIds: readonly string[]): void;
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
  close(): void;
}

interface OpenDatabaseOptions {
  readonly userDataPath: string;
  readonly appPath: string;
}

export function openDatabase({ userDataPath, appPath }: OpenDatabaseOptions): DatabaseRuntime {
  const sqlite = new BetterSqlite3(join(userDataPath, "katarune.sqlite"));

  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");

  const database = drizzle(sqlite);
  migrate(database, { migrationsFolder: join(appPath, "drizzle") });

  const existingThread = database.select().from(threads).where(eq(threads.id, VALIDATION_THREAD_ID)).get();
  const validationThreadRestored = existingThread !== undefined;

  if (existingThread === undefined) {
    const now = new Date();
    database.insert(threads).values({
      id: VALIDATION_THREAD_ID,
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

  const fetchThread = (threadId: string): ThreadMetadata => {
    const thread = database.select().from(threads).where(eq(threads.id, threadId)).get();

    if (thread === undefined) {
      throw new Error(`Thread "${threadId}" was not found.`);
    }

    return threadMetadataSchema.parse({
      remoteId: thread.id,
      status: thread.status,
      title: thread.title,
      lastMessageAt: thread.updatedAt,
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

  return {
    getStatus: () => status,
    listThreads: () =>
      threadListSchema.parse({
        threads: database
          .select()
          .from(threads)
          .where(ne(threads.id, VALIDATION_THREAD_ID))
          .orderBy(desc(threads.updatedAt))
          .all()
          .map((thread) => ({
            remoteId: thread.id,
            status: thread.status,
            title: thread.title,
            lastMessageAt: thread.updatedAt,
          })),
      }),
    initializeThread: (threadId) => {
      const now = new Date();
      database
        .insert(threads)
        .values({
          id: threadId,
          title: "新对话",
          status: "regular",
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing({ target: threads.id })
        .run();

      return initializeThreadResponseSchema.parse({ remoteId: threadId });
    },
    fetchThread,
    renameThread: (threadId, title) => {
      const result = database
        .update(threads)
        .set({ title, updatedAt: new Date() })
        .where(eq(threads.id, threadId))
        .run();
      if (result.changes === 0) fetchThread(threadId);
    },
    setThreadStatus: (threadId, threadStatus) => {
      const result = database
        .update(threads)
        .set({ status: threadStatus, updatedAt: new Date() })
        .where(eq(threads.id, threadId))
        .run();
      if (result.changes === 0) fetchThread(threadId);
    },
    deleteThread: (threadId) => {
      database.delete(threads).where(eq(threads.id, threadId)).run();
    },
    loadThreadMessages: (threadId) =>
      threadMessagesSchema.parse({
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
      }),
    appendThreadMessage: ({ threadId, message }) => {
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
          .where(eq(threads.id, threadId))
          .run();
        if (updatedThread.changes === 0) {
          throw new Error(`Thread "${threadId}" was not found while appending a message.`);
        }
      });
    },
    deleteThreadMessages: (threadId, messageIds) => {
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
    close: () => sqlite.close(),
  };
}
