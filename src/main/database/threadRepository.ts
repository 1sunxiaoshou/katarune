import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import {
  initializeThreadResponseSchema,
  threadListSchema,
  threadMessagesSchema,
  threadMetadataSchema,
  type Character,
  type StoredMessage,
  type ThreadMetadata,
} from "../../shared/ipc";
import { VALIDATION_THREAD_ID } from "./constants";
import { messages, threads } from "./schema";
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
      throw new Error(`Thread "${threadId}" was not found.`);
    }

    return threadMetadataSchema.parse({
      remoteId: thread.id,
      status: thread.status,
      title: thread.title,
      lastMessageAt: thread.lastMessageAt ?? thread.createdAt,
      characterId: thread.characterId,
    });
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
            status: thread.status,
            title: thread.title,
            lastMessageAt: thread.lastMessageAt ?? thread.createdAt,
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
          lastMessageAt: now,
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
      database
        .delete(threads)
        .where(
          and(
            eq(threads.id, threadId),
            eq(threads.characterId, characterId),
          ),
        )
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
        if (
          existingMessage !== undefined &&
          existingMessage.threadId !== threadId
        ) {
          throw new Error(
            `Message "${message.id}" already belongs to another thread.`,
          );
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
      if (messageIds.length === 0) return;
      database
        .delete(messages)
        .where(
          and(
            eq(messages.threadId, threadId),
            inArray(messages.id, messageIds),
          ),
        )
        .run();
    },
  };
}
