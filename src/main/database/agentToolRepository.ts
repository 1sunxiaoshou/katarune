import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { agentAccessModeSchema, directoryAccessSchema, storedDirectoryGrantSchema, type AgentAccessMode, type DirectoryAccess } from "../../shared/agentTools";
import { threadDirectoryGrants, threadToolAccess } from "./schema";
import type { KataruneDatabase } from "./types";
import type { ThreadMetadata } from "../../shared/ipc";
import { OperationRejected } from "../diagnostics/operationRejected";

export function createAgentToolRepository(database: KataruneDatabase, fetchThread: (threadId: string, characterId: string) => ThreadMetadata) {
  const checkThread = (threadId: string, characterId: string) => {
    if (fetchThread(threadId, characterId).kind !== "chat") throw new OperationRejected("operation-not-allowed");
  };
  return {
    getThreadToolAccess(threadId: string, characterId: string) {
      checkThread(threadId, characterId);
      const row = database.select().from(threadToolAccess).where(eq(threadToolAccess.threadId, threadId)).get();
      return {
        mode: agentAccessModeSchema.parse(row?.mode ?? "request-approval"),
        directories: database.select().from(threadDirectoryGrants).where(eq(threadDirectoryGrants.threadId, threadId)).all()
          .map(row => storedDirectoryGrantSchema.parse({ id: row.id, path: row.path, access: row.access })),
      };
    },
    setThreadToolMode(threadId: string, characterId: string, mode: AgentAccessMode) {
      checkThread(threadId, characterId);
      agentAccessModeSchema.parse(mode);
      database.insert(threadToolAccess).values({ threadId, mode }).onConflictDoUpdate({ target: threadToolAccess.threadId, set: { mode } }).run();
    },
    grantThreadDirectory(threadId: string, characterId: string, path: string, access: DirectoryAccess) {
      checkThread(threadId, characterId);
      directoryAccessSchema.parse(access);
      const existing = database.select().from(threadDirectoryGrants).where(and(eq(threadDirectoryGrants.threadId, threadId), eq(threadDirectoryGrants.path, path))).get();
      const id = existing?.id ?? randomUUID();
      database.insert(threadDirectoryGrants).values({ id, threadId, path, access })
        .onConflictDoUpdate({ target: [threadDirectoryGrants.threadId, threadDirectoryGrants.path], set: { access } }).run();
      return storedDirectoryGrantSchema.parse({ id, path, access });
    },
    revokeThreadDirectory(threadId: string, characterId: string, id: string) {
      checkThread(threadId, characterId);
      database.delete(threadDirectoryGrants).where(and(eq(threadDirectoryGrants.threadId, threadId), eq(threadDirectoryGrants.id, id))).run();
    },
  };
}
