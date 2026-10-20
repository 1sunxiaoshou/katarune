import { randomUUID } from "node:crypto";
import { and, asc, count, desc, eq, ne, isNull, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import {
  memoryContentSchema, memoryDay, memoryEntrySchema, memoryListSchema,
  memorySaveInputSchema, memorySearchInputSchema, memorySummarySchema,
  type DiaryDraft, type ListMemoryRequest, type MemoryEntry, type MemorySaveInput, type MemoryWriteResult,
} from "../../shared/memory";
import { memoryDiaryJobs, memoryDiaryMessages, memoryEntries, memoryPreferences, messages, threads } from "./schema";
import type { KataruneDatabase } from "./types";

type EntryRow = typeof memoryEntries.$inferSelect;
type DiaryJob = typeof memoryDiaryJobs.$inferSelect;
const searchLimit = 6;

export class MemoryNotFoundError extends Error {
  constructor() { super("未找到这条角色记忆。"); }
}

export class MemoryDuplicateError extends Error {
  constructor(readonly existing: { id: string; title: string }, message: string) { super(message); }
}

const transcriptContentSchema = z.object({
  role: z.enum(["user", "assistant"]),
  parts: z.array(z.object({ type: z.string(), text: z.string().optional() }).passthrough()),
}).passthrough();

function summary(row: EntryRow) {
  return memorySummarySchema.parse({
    id: row.id, kind: row.kind, title: row.title,
    day: row.day, isUser: row.isUser,
    updatedAt: row.updatedAt,
  });
}

function content(row: EntryRow) {
  const base = { kind: row.kind, title: row.title, body: row.body };
  return memoryContentSchema.parse(row.kind === "diary" ? { ...base, day: row.day }
    : row.kind === "person" ? { ...base, isUser: row.isUser } : base);
}

function searchPattern(query: string): string {
  return `%${query.replace(/[!%_]/g, character => `!${character}`)}%`;
}

export function createMemoryRepository(database: KataruneDatabase, assertCharacter: (id: string) => unknown) {
  const listeners = new Set<(characterId: string) => void>();
  const changedCharacters = new Set<string>();
  const notify = (characterId: string) => {
    changedCharacters.add(characterId);
    queueMicrotask(() => {
      if (!changedCharacters.delete(characterId)) return;
      for (const listener of listeners) listener(characterId);
    });
  };
  const find = (characterId: string, id: string): EntryRow => {
    assertCharacter(characterId);
    const row = database.select().from(memoryEntries).where(and(eq(memoryEntries.characterId, characterId), eq(memoryEntries.id, id))).get();
    if (!row) throw new MemoryNotFoundError();
    return row;
  };
  const readMemory = (characterId: string, id: string): MemoryEntry => {
    const row = find(characterId, id);
    return memoryEntrySchema.parse({
      id: row.id, characterId, content: content(row), revision: row.revision,
      updatedAt: row.updatedAt, forgottenAt: row.forgottenAt,
    });
  };
  const saveMemory = (characterId: string, input: MemorySaveInput): MemoryWriteResult => {
    const request = memorySaveInputSchema.parse(input);
    assertCharacter(characterId);
    return database.transaction((): MemoryWriteResult => {
      const previous = request.id ? find(characterId, request.id) : undefined;
      if (previous && (previous.revision !== request.revision || previous.forgottenAt)) return { status: "conflict" };
      if (previous && previous.kind !== request.content.kind) throw new Error("不能更改记忆的分类。");
      if (previous?.kind === "diary" && previous.day !== (request.content.kind === "diary" ? request.content.day : null)) throw new Error("不能更改日记的日期。");
      const id = previous?.id ?? randomUUID();
      if (request.content.kind === "person" && request.content.isUser) {
        const user = database.select().from(memoryEntries).where(and(eq(memoryEntries.characterId, characterId), eq(memoryEntries.isUser, true), isNull(memoryEntries.forgottenAt))).get();
        if (user && user.id !== id) throw new MemoryDuplicateError({ id: user.id, title: user.title }, "已有用户画像，请更新原有画像。");
      }
      // Creating the same named entity twice returns an actionable conflict rather than duplicating it.
      if (!previous && request.content.kind !== "diary") {
        const duplicate = database.select().from(memoryEntries).where(and(eq(memoryEntries.characterId, characterId), eq(memoryEntries.kind, request.content.kind),
          sql`lower(${memoryEntries.title}) = lower(${request.content.title})`, isNull(memoryEntries.forgottenAt))).get();
        if (duplicate) throw new MemoryDuplicateError({ id: duplicate.id, title: duplicate.title }, "已有同名记忆，请搜索并更新原有条目；同名人物请用称谓区分。");
      }
      const now = new Date();
      const values = {
        title: request.content.title, body: request.content.body,
        day: request.content.kind === "diary" ? request.content.day : null,
        isUser: request.content.kind === "person" && request.content.isUser,
        revision: (previous?.revision ?? 0) + 1, updatedAt: now,
      };
      if (previous) database.update(memoryEntries).set(values).where(eq(memoryEntries.id, id)).run();
      else database.insert(memoryEntries).values({ id, characterId, kind: request.content.kind, ...values }).run();
      notify(characterId);
      return { status: "saved", entry: readMemory(characterId, id) };
    });
  };
  const diaryState = (characterId: string) => {
    assertCharacter(characterId);
    database.update(memoryDiaryJobs).set({ status: "failed" }).where(and(eq(memoryDiaryJobs.characterId, characterId), eq(memoryDiaryJobs.status, "running"), lte(memoryDiaryJobs.retryAt, new Date()))).run();
    const enabled = database.select().from(memoryPreferences).where(eq(memoryPreferences.characterId, characterId)).get()?.diaryEnabled ?? true;
    const jobs = database.select({ status: memoryDiaryJobs.status, value: count() }).from(memoryDiaryJobs).where(eq(memoryDiaryJobs.characterId, characterId)).groupBy(memoryDiaryJobs.status).all();
    return { enabled, pending: jobs.filter(j => ["pending", "running"].includes(j.status)).reduce((n, j) => n + j.value, 0), failed: jobs.find(j => j.status === "failed")?.value ?? 0 };
  };
  return {
    subscribeMemoryChanges: (listener: (characterId: string) => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    readMemory, saveMemory,
    listMemory: (request: ListMemoryRequest) => {
      assertCharacter(request.characterId);
      const where = and(eq(memoryEntries.characterId, request.characterId), eq(memoryEntries.kind, request.kind),
        isNull(memoryEntries.forgottenAt),
        request.query ? sql`(${memoryEntries.title} like ${searchPattern(request.query)} escape '!' or ${memoryEntries.body} like ${searchPattern(request.query)} escape '!')` : undefined);
      return memoryListSchema.parse({
        entries: database.select().from(memoryEntries).where(where).orderBy(desc(memoryEntries.day), desc(memoryEntries.updatedAt), asc(memoryEntries.id)).limit(100).offset(request.offset).all().map(summary),
        total: database.select({ value: count() }).from(memoryEntries).where(where).get()?.value ?? 0,
      });
    },
    searchMemory: (characterId: string, value: z.input<typeof memorySearchInputSchema>, includeDiaries = true) => {
      const request = memorySearchInputSchema.parse(value);
      assertCharacter(characterId);
      const pattern = searchPattern(request.query);
      const rows = database.select().from(memoryEntries).where(and(eq(memoryEntries.characterId, characterId), isNull(memoryEntries.forgottenAt),
        includeDiaries ? undefined : ne(memoryEntries.kind, "diary"),
        request.kind ? eq(memoryEntries.kind, request.kind) : undefined,
        sql`(${memoryEntries.title} like ${pattern} escape '!' or ${memoryEntries.body} like ${pattern} escape '!')`))
        .orderBy(desc(memoryEntries.isUser), desc(memoryEntries.updatedAt)).limit(searchLimit + 1).all();
      return { status: "ok" as const, truncated: rows.length > searchLimit, results: rows.slice(0, searchLimit).map(row => {
        const start = Math.max(0, row.body.toLocaleLowerCase().indexOf(request.query.toLocaleLowerCase()) - 80);
        const bodyTruncated = row.body.length > 800;
        return { ...content(row), id: row.id, revision: row.revision,
          body: bodyTruncated ? row.body.slice(start, start + 400) : row.body, bodyTruncated };
      }) };
    },
    memoryOverview: (characterId: string) => {
      assertCharacter(characterId);
      const rows = database.select().from(memoryEntries).where(and(eq(memoryEntries.characterId, characterId), isNull(memoryEntries.forgottenAt)))
        .orderBy(desc(memoryEntries.isUser), desc(memoryEntries.updatedAt)).limit(24).all();
      return rows.map(row => ({ ...summary(row), ...(row.isUser ? { profile: row.body.slice(0, 1800) } : {}) }));
    },
    forgetMemory: (characterId: string, id: string, revision: number): MemoryWriteResult => database.transaction(() => {
      const row = find(characterId, id);
      if (row.revision !== revision || row.forgottenAt) return { status: "conflict" };
      const now = new Date();
      database.update(memoryEntries).set({ forgottenAt: now, updatedAt: now, revision: row.revision + 1 }).where(eq(memoryEntries.id, id)).run();
      if (row.day) database.update(memoryDiaryJobs).set({ status: "forgotten" }).where(and(eq(memoryDiaryJobs.characterId, characterId), eq(memoryDiaryJobs.day, row.day))).run();
      notify(characterId);
      return { status: "saved", entry: readMemory(characterId, id) };
    }),
    getMemoryDiaryState: diaryState,
    setMemoryDiaryEnabled: (characterId: string, enabled: boolean) => {
      assertCharacter(characterId);
      database.insert(memoryPreferences).values({ characterId, diaryEnabled: enabled }).onConflictDoUpdate({ target: memoryPreferences.characterId, set: { diaryEnabled: enabled } }).run();
      notify(characterId);
      return diaryState(characterId);
    },
    queueMemoryDiaryMessage: (characterId: string, messageId: string, timeZone: string) => {
      if (!diaryState(characterId).enabled) return;
      const row = database.select({ createdAt: messages.createdAt, content: messages.content }).from(messages).innerJoin(threads, eq(threads.id, messages.threadId))
        .where(and(eq(messages.id, messageId), eq(threads.characterId, characterId))).get();
      if (!row || !transcriptContentSchema.safeParse(row.content).success) return;
      const day = memoryDay(row.createdAt, timeZone);
      database.transaction(() => {
        database.insert(memoryDiaryJobs).values({ id: randomUUID(), characterId, day, timeZone, retryAt: new Date() }).onConflictDoNothing().run();
        const job = database.select().from(memoryDiaryJobs).where(and(eq(memoryDiaryJobs.characterId, characterId), eq(memoryDiaryJobs.day, day))).get();
        if (!job || !["pending", "failed"].includes(job.status)) return;
        database.insert(memoryDiaryMessages).values({ jobId: job.id, messageId }).onConflictDoNothing().run();
        notify(characterId);
      });
    },
    retryMemoryDiaryJobs: (characterId: string) => {
      assertCharacter(characterId);
      database.update(memoryDiaryJobs).set({ status: "pending", retryAt: new Date(0) }).where(and(eq(memoryDiaryJobs.characterId, characterId),
        or(eq(memoryDiaryJobs.status, "failed"), and(eq(memoryDiaryJobs.status, "running"), lte(memoryDiaryJobs.retryAt, new Date()))))).run();
      notify(characterId);
      return diaryState(characterId);
    },
    claimMemoryDiaryJob: (now: Date): DiaryJob | null => database.transaction(() => {
      database.update(memoryDiaryJobs).set({ status: "failed" }).where(and(eq(memoryDiaryJobs.status, "running"), lte(memoryDiaryJobs.retryAt, now))).run();
      const candidates = database.select().from(memoryDiaryJobs).where(and(lte(memoryDiaryJobs.retryAt, now),
        eq(memoryDiaryJobs.status, "pending")))
        .orderBy(asc(memoryDiaryJobs.day)).all();
      const job = candidates.find(candidate => candidate.day < memoryDay(now, candidate.timeZone) && diaryState(candidate.characterId).enabled);
      if (!job) return null;
      database.update(memoryDiaryJobs).set({ status: "running", attempts: job.attempts + 1, retryAt: new Date(now.getTime() + 10 * 60_000) }).where(eq(memoryDiaryJobs.id, job.id)).run();
      return { ...job, status: "running", attempts: job.attempts + 1 };
    }),
    memoryDiaryTranscript: (job: DiaryJob) => {
      const rows = database.select({ id: messages.id, threadId: messages.threadId, content: messages.content, createdAt: messages.createdAt }).from(memoryDiaryMessages)
        .innerJoin(messages, eq(messages.id, memoryDiaryMessages.messageId)).innerJoin(threads, eq(threads.id, messages.threadId))
        .where(and(eq(memoryDiaryMessages.jobId, job.id), eq(threads.characterId, job.characterId))).orderBy(asc(messages.createdAt), asc(messages.id)).all();
      return rows.flatMap(row => {
        const parsed = transcriptContentSchema.safeParse(row.content);
        if (!parsed.success) return [];
        const text = parsed.data.parts.filter(part => part.type === "text").map(part => part.text ?? "").join("\n").trim();
        return text ? [{ id: row.id, threadId: row.threadId, role: parsed.data.role, text, createdAt: row.createdAt }] : [];
      });
    },
    finishMemoryDiaryJob: (job: DiaryJob, draft: DiaryDraft) => database.transaction(() => {
      const current = database.select().from(memoryDiaryJobs).where(eq(memoryDiaryJobs.id, job.id)).get();
      if (!current || current.status !== "running" || current.attempts !== job.attempts || !diaryState(job.characterId).enabled) return;
      if (draft.worthKeeping) {
        // Deleted conversations must not produce a diary after generation returns.
        const evidence = database.select({ messageId: memoryDiaryMessages.messageId }).from(memoryDiaryMessages)
          .where(eq(memoryDiaryMessages.jobId, job.id)).get();
        if (!evidence) { database.update(memoryDiaryJobs).set({ status: "skipped" }).where(eq(memoryDiaryJobs.id, job.id)).run(); return; }
        const result = saveMemory(job.characterId, { id: null, revision: null, content: { kind: "diary", day: job.day, title: draft.title, body: draft.body } });
        if (result.status !== "saved") throw new Error("日记写入冲突。");
      }
      database.update(memoryDiaryJobs).set({ status: draft.worthKeeping ? "done" : "skipped" }).where(eq(memoryDiaryJobs.id, job.id)).run();
      notify(job.characterId);
    }),
    failMemoryDiaryJob: (job: DiaryJob, now: Date) => {
      database.update(memoryDiaryJobs).set({ status: "failed", retryAt: now })
        .where(and(eq(memoryDiaryJobs.id, job.id), eq(memoryDiaryJobs.status, "running"), eq(memoryDiaryJobs.attempts, job.attempts))).run();
      notify(job.characterId);
    },
  };
}
