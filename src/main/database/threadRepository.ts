import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { OperationRejected } from "../diagnostics/operationRejected";
import {
  CHAT_ATTACHMENT_LIMITS,
  assetSchema,
  initializeThreadResponseSchema,
  threadListSchema,
  threadMessagesSchema,
  threadMetadataSchema,
  type Character,
  type StoredMessage,
  type ThreadMetadata,
} from "../../shared/ipc";
import { VALIDATION_THREAD_ID } from "./constants";
import { assetColumns } from "./assetRepository";
import { assets, messageAssets, messages, threads } from "./schema";
import type {
  KataruneDatabase,
  ThreadRepository,
} from "./types";

export function createThreadRepository(
  database: KataruneDatabase,
  fetchCharacter: (id: string) => Character,
): ThreadRepository {
  const fetchThread = (
    threadId: string,
    characterId: string,
  ): ThreadMetadata => {
    const thread = database
      .select()
      .from(threads)
      .where(
        and(
          eq(threads.id, threadId),
          eq(threads.characterId, characterId),
        ),
      )
      .get();

    if (thread === undefined) {
      throw new OperationRejected("resource-unavailable");
    }

    return threadMetadataSchema.parse({
      remoteId: thread.id,
      kind: thread.kind,
      status: thread.status,
      title: thread.title,
      lastMessageAt: thread.lastMessageAt ?? thread.createdAt,
      characterId: thread.characterId,
    });
  };

  const initializeThread: ThreadRepository["initializeThread"] = (threadId, characterId, kind = "chat") => {
    fetchCharacter(characterId);
    const now = new Date();
    database
      .insert(threads)
      .values({
        id: threadId,
        kind,
        characterId,
        title: "新对话",
        status: "regular",
        lastMessageAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing({ target: threads.id })
      .run();

    fetchThread(threadId, characterId);
    return initializeThreadResponseSchema.parse({ remoteId: threadId });
  };

  return {
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
          .orderBy(
            desc(
              sql`coalesce(${threads.lastMessageAt}, ${threads.createdAt})`,
            ),
            desc(threads.createdAt),
            desc(threads.id),
          )
          .all()
          .map((thread) => ({
            remoteId: thread.id,
            kind: thread.kind,
            status: thread.status,
            title: thread.title,
            lastMessageAt: thread.lastMessageAt ?? thread.createdAt,
            characterId: thread.characterId,
          })),
      }),
    initializeThread,
    fetchThread,
    renameThread: (threadId, characterId, title) => {
      const result = database
        .update(threads)
        .set({ title, updatedAt: new Date() })
        .where(
          and(
            eq(threads.id, threadId),
            eq(threads.characterId, characterId),
          ),
        )
        .run();
      if (result.changes === 0) fetchThread(threadId, characterId);
    },
    setThreadStatus: (threadId, characterId, threadStatus) => {
      const result = database
        .update(threads)
        .set({ status: threadStatus, updatedAt: new Date() })
        .where(
          and(
            eq(threads.id, threadId),
            eq(threads.characterId, characterId),
          ),
        )
        .run();
      if (result.changes === 0) fetchThread(threadId, characterId);
    },
    deleteThread: (threadId, characterId) => {
      fetchThread(threadId, characterId);
      const candidateAssetIds = database
        .selectDistinct({ assetId: messageAssets.assetId })
        .from(messageAssets)
        .innerJoin(messages, eq(messages.id, messageAssets.messageId))
        .where(eq(messages.threadId, threadId))
        .all()
        .map(({ assetId }) => assetId);
      database
        .delete(threads)
        .where(
          and(
            eq(threads.id, threadId),
            eq(threads.characterId, characterId),
          ),
        )
        .run();
      return candidateAssetIds;
    },
    loadThreadMessages: (threadId, characterId, recentLimit) => {
      fetchThread(threadId, characterId);
      if (recentLimit !== undefined && (!Number.isSafeInteger(recentLimit) || recentLimit < 1 || recentLimit > 100)) throw new Error("Invalid recent message limit.");
      const query = database.select({ id: messages.id, parent_id: messages.parentId, format: messages.format, content: messages.content })
        .from(messages).where(eq(messages.threadId, threadId))
        .orderBy(recentLimit === undefined ? asc(messages.createdAt) : desc(messages.createdAt), recentLimit === undefined ? asc(sql`rowid`) : desc(sql`rowid`));
      return threadMessagesSchema.parse({
        messages: recentLimit === undefined ? query.all() : query.limit(recentLimit).all().reverse(),
      });
    },
    appendThreadMessage: ({ threadId, characterId, message, assetIds }, initializeKind) => {
      database.transaction((transaction) => {
        if (initializeKind !== undefined) initializeThread(threadId, characterId, initializeKind);
        const thread = fetchThread(threadId, characterId);
        if (initializeKind !== undefined && thread.kind !== initializeKind)
          throw new Error("会话类型与待保存消息不匹配。");
        const referencedAssets =
          assetIds.length === 0
            ? []
            : transaction
                .select({
                  id: assets.id,
                  kind: assets.kind,
                  status: assets.status,
                  byteSize: assets.byteSize,
                })
                .from(assets)
                .where(inArray(assets.id, assetIds))
                .all();
        if (
          referencedAssets.length !== assetIds.length ||
          referencedAssets.some(
            (asset) =>
              asset.kind !== "chat_attachment" ||
              asset.status !== "ready" ||
              asset.byteSize === null ||
              asset.byteSize > CHAT_ATTACHMENT_LIMITS.maxFileBytes,
          )
        ) {
          throw new OperationRejected("resource-unavailable", "消息引用了不存在或不可用的聊天附件。");
        }
        const totalAttachmentBytes = referencedAssets.reduce(
          (total, asset) => total + (asset.byteSize ?? 0),
          0,
        );
        if (
          totalAttachmentBytes >
          CHAT_ATTACHMENT_LIMITS.maxTotalBytesPerMessage
        ) {
          throw new OperationRejected("invalid-input", "单条消息的附件合计不能超过 50 MiB。");
        }

        const existingMessage = transaction
          .select({ threadId: messages.threadId })
          .from(messages)
          .where(eq(messages.id, message.id))
          .get();
        if (
          existingMessage !== undefined &&
          existingMessage.threadId !== threadId
        ) {
          throw new OperationRejected("ownership-mismatch");
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
        transaction
          .delete(messageAssets)
          .where(eq(messageAssets.messageId, message.id))
          .run();
        if (assetIds.length > 0) {
          transaction
            .insert(messageAssets)
            .values(
              assetIds.map((assetId) => ({
                messageId: message.id,
                assetId,
              })),
            )
            .run();
        }
        const updatedThread = transaction
          .update(threads)
          .set({ lastMessageAt: now, updatedAt: now })
          .where(
            and(
              eq(threads.id, threadId),
              eq(threads.characterId, characterId),
            ),
          )
          .run();
        if (updatedThread.changes === 0) {
          throw new Error(
            `Thread "${threadId}" was not found while appending a message.`,
          );
        }
      });
    },
    deleteThreadMessages: (threadId, characterId, messageIds) => {
      fetchThread(threadId, characterId);
      if (messageIds.length === 0) return [];
      const candidateAssetIds = database
        .selectDistinct({ assetId: messageAssets.assetId })
        .from(messageAssets)
        .innerJoin(messages, eq(messages.id, messageAssets.messageId))
        .where(
          and(
            eq(messages.threadId, threadId),
            inArray(messages.id, messageIds),
          ),
        )
        .all()
        .map(({ assetId }) => assetId);
      database
        .delete(messages)
        .where(
          and(
            eq(messages.threadId, threadId),
            inArray(messages.id, messageIds),
          ),
        )
        .run();
      return candidateAssetIds;
    },
    fetchThreadChatAttachment: (threadId, characterId, assetId) => {
      fetchThread(threadId, characterId);
      const asset = database
        .select(assetColumns)
        .from(assets)
        .innerJoin(messageAssets, eq(messageAssets.assetId, assets.id))
        .innerJoin(messages, eq(messages.id, messageAssets.messageId))
        .where(
          and(
            eq(assets.id, assetId),
            eq(assets.kind, "chat_attachment"),
            eq(messages.threadId, threadId),
          ),
        )
        .get();
      if (asset === undefined) {
        throw new OperationRejected("resource-unavailable");
      }
      return assetSchema.parse(asset);
    },
  };
}
