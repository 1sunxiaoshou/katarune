import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import BetterSqlite3 from "better-sqlite3";
import { MockLanguageModelV4 } from "ai/test";
import { z } from "zod";
import { openDatabase } from "../src/main/database/database";
import { validateModelMetadata, validateModelSettings, validateProviderSettings } from "../src/main/ai/providerDefinitions";
import { createDiaryService } from "../src/main/memory/diaryService";
import { createMemoryTools, createMemoryReadTools } from "../src/main/memory/memoryTools";
import { memoryDay, memoryToolSaveSchema, type MemoryContent, type MemoryEntry, type MemoryWriteResult } from "../src/shared/memory";

function saved(result: MemoryWriteResult): MemoryEntry {
  assert.equal(result.status, "saved");
  if (result.status !== "saved") throw new Error("Expected saved memory");
  return result.entry;
}

export async function runMemoryIntegration(): Promise<void> {
  runMemorySimplificationMigration();
  const directory = mkdtempSync(join(tmpdir(), "katarune-memory-test-"));
  const configValidator = { validateModelMetadata, validateModelSettings, validateProviderSettings };
  let database = openDatabase({ userDataPath: directory, appPath: process.cwd(), configValidator });
  const sql = new BetterSqlite3(join(directory, "katarune.sqlite"));
  try {
    const characterId = database.getAppState().activeCharacter.id;
    database.updateCharacter({ id: characterId, systemPrompt: "你是安静、细心的数字伙伴，喜欢用简洁而温暖的语言记录生活。" });
    const second = database.createCharacter({ name: "另一个角色", systemPrompt: "", modelConfigId: null, speechModelConfigId: null, speechVoice: null });
    const threadId = "memory-source-thread";
    database.initializeThread(threadId, characterId);
    const append = (id: string, text: string) => database.appendThreadMessage({ threadId, characterId,
      message: { id, parent_id: null, format: "ai-sdk/v6", content: { role: "user", parts: [{ type: "text", text }] } }, assetIds: [] });
    append("memory-source", "我的朋友小林下周过生日，我打算选一本书。");
    const add = (content: MemoryContent) => saved(database.saveMemory(characterId, { id: null, revision: null, content }));
    const person = add({ kind: "person", title: "小林", body: "用户的朋友。", isUser: false });
    const event = add({ kind: "event", title: "准备生日礼物", body: "准备给小林挑一本书。" });
    assert.throws(() => database.readMemory(second.id, person.id));
    assert.deepEqual(database.searchMemory(second.id, { query: "小林", kind: null }).results, []);
    saved(database.saveMemory(second.id, { id: null, revision: null, content: { kind: "person", title: "另一个人", body: "只属于第二个角色。", isUser: false } }));
    assert.throws(() => database.saveMemory(second.id, { id: person.id, revision: person.revision, content: person.content }));
    saved(database.saveMemory(characterId, { id: person.id, revision: person.revision, content: { kind: "person", title: "林同学", body: "用户的朋友，称呼已更正。", isUser: false } }));
    assert.equal(database.saveMemory(characterId, { id: person.id, revision: person.revision, content: person.content }).status, "conflict", "a stale edit must not overwrite the correction");
    assert.equal(database.readMemory(characterId, person.id).content.title, "林同学");
    assert.equal(database.saveMemory(characterId, { id: person.id, revision: 1, content: person.content }).status, "conflict");
    assert.equal(database.searchMemory(characterId, { query: "称呼", kind: null }).results[0]?.id, person.id);
    assert.equal(database.searchMemory(characterId, { query: "%", kind: null }).results.length, 0);
    assert.equal(database.searchMemory(characterId, { query: "_", kind: null }).results.length, 0);
    add({ kind: "person", title: "用户", body: "喜欢简洁的回答。", isUser: true });
    assert.throws(() => add({ kind: "person", title: "本人", body: "重复画像。", isUser: true }));
    assert.throws(() => add({ kind: "person", title: "林同学", body: "重复人物。", isUser: false }));

    const tools = createMemoryTools(database, characterId);
    assert.deepEqual(Object.keys(tools), ["memory_search", "memory_read", "memory_save", "memory_forget"]);
    const options = { toolCallId: "memory-tool-check", messages: [], context: {} };
    const update = tools.memory_save.execute;
    assert.ok(update);
    const short = database.searchMemory(characterId, { query: "生日", kind: "event" }).results[0];
    assert.ok(short);
    assert.equal(short.body, event.content.body);
    assert.equal(short.bodyTruncated, false);
    const result = await update({ id: short.id, revision: short.revision, kind: "event", title: short.title, body: "已经挑好了书。", isUser: null }, options);
    assert.deepEqual(result, { status: "saved", id: event.id, revision: short.revision + 1 });
    assert.equal(database.readMemory(characterId, event.id).content.kind === "event" && database.readMemory(characterId, event.id).content.body, "已经挑好了书。");

    const stale = z.object({ status: z.literal("conflict"), message: z.string() }).parse(await update({
      id: short.id, revision: short.revision, kind: "event", title: short.title, body: "过时修改。", isUser: null,
    }, options));
    assert.ok(stale.message.includes("重新读取"));
    const duplicate = z.object({ status: z.literal("duplicate"), existing: z.object({ id: z.uuid(), title: z.string() }) }).parse(await update({
      id: null, revision: null, kind: "event", title: event.content.title, body: "不应重复新增。", isUser: null,
    }, options));
    assert.equal(duplicate.existing.id, event.id);
    const duplicateUser = z.object({ status: z.literal("duplicate"), existing: z.object({ id: z.uuid() }) }).parse(await update({
      id: null, revision: null, kind: "person", title: "新的称呼", body: "用户画像仍应只有一份。", isUser: true,
    }, options));
    assert.equal(duplicateUser.existing.id, database.memoryOverview(characterId).find(item => item.isUser)?.id);
    assert.equal(memoryToolSaveSchema.safeParse({ id: event.id, revision: null, kind: "event", title: "无效修改", body: "正文", isUser: null }).success, false);
    assert.equal(memoryToolSaveSchema.safeParse({ id: null, revision: null, kind: "person", title: "人物", body: "正文", isUser: null }).success, false);
    const temporary = add({ kind: "event", title: "一段长记录", body: "前言。".repeat(300) + "长文检索词：要保留的末尾。" });
    const long = database.searchMemory(characterId, { query: "长文检索词", kind: null }).results[0];
    assert.ok(long);
    assert.equal(long.bodyTruncated, true);
    assert.ok(long.body.includes("长文检索词"));
    const read = tools.memory_read.execute;
    const forget = tools.memory_forget.execute;
    assert.ok(read); assert.ok(forget);
    const full = z.object({ status: z.literal("found"), entry: z.object({ body: z.string(), bodyTruncated: z.literal(false) }) }).parse(await read({ id: temporary.id }, options));
    assert.equal(full.entry.body, temporary.content.body);
    assert.deepEqual(await read({ id: second.id }, options), { status: "not_found" });
    assert.deepEqual(await read({ id: database.memoryOverview(second.id)[0]!.id }, options), { status: "not_found" }, "other characters' entries must remain inaccessible");
    const inaccessible = z.object({ status: z.literal("not_found") }).parse(await update({
      id: database.memoryOverview(second.id)[0]!.id, revision: 1, kind: "event", title: "越权更新", body: "不应写入其他角色。", isUser: null,
    }, options));
    assert.equal(inaccessible.status, "not_found");
    assert.equal(database.memoryOverview(second.id)[0]?.title, "另一个人");
    z.object({ status: z.literal("conflict") }).parse(await forget({ id: event.id, revision: short.revision }, options));
    assert.equal(database.readMemory(characterId, event.id).forgottenAt, null, "a stale forget must preserve the current memory");
    assert.deepEqual(await forget({ id: temporary.id, revision: temporary.revision }, options), { status: "forgotten", id: temporary.id, revision: temporary.revision + 1 });
    assert.deepEqual(await read({ id: temporary.id }, options), { status: "not_found" });

    const zone = "Asia/Shanghai";
    assert.equal(memoryDay(new Date("2026-01-01T16:00:00Z"), zone), "2026-01-02");
    // Queue actual persisted messages, then move their timestamps and job day to a past local day.
    database.queueMemoryDiaryMessage(characterId, "memory-source", zone);
    const today = new Date();
    const past = new Date(today.getTime() - 2 * 86_400_000);
    const day = memoryDay(past, zone);
    sql.prepare("UPDATE memory_diary_jobs SET day = ?, retry_at = ?").run(day, past.getTime());
    sql.prepare("UPDATE messages SET created_at = ? WHERE id = 'memory-source'").run(past.getTime());
    let calls = 0;
    const model = new MockLanguageModelV4({ doGenerate: async () => {
      calls++;
      return {
        content: calls <= 2 ? [{ type: "tool-call", toolCallId: `diary-read-${calls}`, toolName: calls === 1 ? "memory_search" : "memory_read", input: JSON.stringify(calls === 1 ? { query: "林同学", kind: null } : { id: person.id }) }]
          : [{ type: "tool-call", toolCallId: "diary-finish", toolName: "finish_diary", input: JSON.stringify({ worthKeeping: true, title: "一起挑选礼物", body: "今天我和用户聊了朋友的生日，我们一起想了想礼物。" }) }],
        finishReason: { unified: "tool-calls", raw: undefined }, warnings: [],
        usage: { inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 1, text: 1, reasoning: undefined } },
      };
    } });
    const modelConfig = "00000000-0000-4000-8000-000000000099";
    const service = createDiaryService({ database: { ...database, getAppSettings: () => ({ ...database.getAppSettings(), defaultLanguageModelConfigId: modelConfig }) },
      aiRuntime: { resolveLanguageModel: () => model }, now: () => today });
    await service.runOnce();
    await service.runOnce();
    assert.equal(calls, 3, "one daily agent run may use several model/tool steps but must not run twice");
    assert.ok(JSON.stringify(model.doGenerateCalls[0]?.prompt).includes(database.fetchCharacter(characterId).systemPrompt));
    assert.deepEqual(model.doGenerateCalls[0]?.tools?.map(item => item.name).sort(), ["finish_diary", "memory_read", "memory_search"]);
    const diary = database.listMemory({ characterId, kind: "diary", query: "", offset: 0 }).entries[0];
    assert.ok(diary);
    assert.equal(diary.day, day);
    const backgroundTools = createMemoryReadTools(database, characterId, { includeDiaries: false });
    assert.deepEqual(Object.keys(backgroundTools), ["memory_search", "memory_read"]);
    assert.ok(backgroundTools.memory_read.execute);
    assert.deepEqual(await backgroundTools.memory_read.execute({ id: diary.id }, options), { status: "not_found" });
    assert.equal(database.searchMemory(characterId, { query: "一起挑选礼物", kind: null }, false).results.length, 0);
    assert.equal(database.searchMemory(characterId, { query: "一起挑选礼物", kind: null }).results[0]?.id, diary.id);
    for (const definition of model.doGenerateCalls[0]?.tools ?? []) {
      if (definition.type !== "function") continue;
      const schema = z.object({ type: z.literal("object"), properties: z.record(z.string(), z.unknown()), required: z.array(z.string()) }).parse(definition.inputSchema);
      assert.deepEqual(new Set(schema.required), new Set(Object.keys(schema.properties)), "provider-facing tool parameters must be explicit, including nullable filters");
    }
    service.dispose();

    const forgotten = saved(database.forgetMemory(characterId, person.id, database.readMemory(characterId, person.id).revision));
    assert.equal(database.searchMemory(characterId, { query: "林同学", kind: null }).results.length, 0);
    assert.ok(!database.memoryOverview(characterId).some(item => item.id === person.id));
    assert.ok(forgotten.forgottenAt);
    assert.ok(!database.listMemory({ characterId, kind: "person", query: "", offset: 0 }).entries.some(item => item.id === person.id));
    assert.equal(database.saveMemory(characterId, { id: person.id, revision: forgotten.revision, content: person.content }).status, "conflict", "a background save must not revive forgotten memory");
    assert.deepEqual(await read({ id: person.id }, options), { status: "not_found" });
    saved(database.forgetMemory(characterId, diary.id, database.readMemory(characterId, diary.id).revision));
    assert.equal(database.claimMemoryDiaryJob(new Date(today.getTime() + 86_400_000)), null, "forgotten diaries must not regenerate");
    database.setMemoryDiaryEnabled(characterId, false);
    append("disabled-diary", "关闭日记后不排队。");
    database.queueMemoryDiaryMessage(characterId, "disabled-diary", zone);
    assert.equal(database.getMemoryDiaryState(characterId).pending, 0);

    // Failed generation keeps a retryable task; a source edit while generating invalidates the draft.
    database.setMemoryDiaryEnabled(characterId, true);
    append("retry-source", "周末练习了钢琴。");
    database.queueMemoryDiaryMessage(characterId, "retry-source", zone);
    const retryDay = memoryDay(new Date(past.getTime() + 86_400_000), zone);
    sql.prepare("UPDATE memory_diary_jobs SET day = ?, retry_at = ? WHERE status = 'pending'").run(retryDay, past.getTime());
    let clock = today;
    let editDuringGeneration = false;
    let retryCalls = 0;
    const retry = createDiaryService({ database: { ...database, getAppSettings: () => ({ ...database.getAppSettings(), defaultLanguageModelConfigId: modelConfig }) },
      aiRuntime: { resolveLanguageModel: () => model }, now: () => clock,
      generate: async () => {
        retryCalls++;
        if (!editDuringGeneration) throw new Error("synthetic provider failure");
        append("retry-source", "更正：只是打算练习，还没有开始。");
        return { worthKeeping: true, title: "不应保存的草稿", body: "过时资料。" };
      } });
    await retry.runOnce();
    assert.equal(database.getMemoryDiaryState(characterId).failed, 1);
    assert.deepEqual(database.getMemoryDiaryState(characterId).lastFailure, { day: retryDay, code: "unknown" });
    assert.deepEqual(sql.prepare("SELECT failure_code FROM memory_diary_jobs WHERE day = ?").get(retryDay), { failure_code: "unknown" }, "only a controlled failure category is persisted");
    await retry.runOnce();
    assert.equal(retryCalls, 1, "failure must not cause an automatic second agent run");
    clock = new Date(clock.getTime() + 7 * 60 * 60_000);
    editDuringGeneration = true;
    database.retryMemoryDiaryJobs(characterId);
    assert.equal(database.getMemoryDiaryState(characterId).lastFailure, null);
    await retry.runOnce();
    assert.equal(retryCalls, 2, "an explicit retry may run the agent again");
    assert.deepEqual(database.getMemoryDiaryState(characterId).lastFailure, { day: retryDay, code: "context_changed" });
    assert.equal(database.searchMemory(characterId, { query: "不应保存", kind: null }).results.length, 0);
    retry.dispose();

    const nextDay = new Date(clock.getTime() + 86_400_000);
    database.retryMemoryDiaryJobs(characterId);
    const lease = database.claimMemoryDiaryJob(nextDay);
    assert.ok(lease);
    assert.equal(database.claimMemoryDiaryJob(nextDay), null, "an active lease must not be claimed twice");
    const reclaimed = database.claimMemoryDiaryJob(new Date(nextDay.getTime() + 11 * 60_000));
    assert.equal(reclaimed, null, "interrupted jobs must require a manual retry");
    assert.deepEqual(database.getMemoryDiaryState(characterId).lastFailure, { day: retryDay, code: "interrupted" });
    assert.equal(database.getMemoryDiaryState(characterId).failed, 1);
    append("nothing-worth-keeping", "早上好。");
    database.queueMemoryDiaryMessage(characterId, "nothing-worth-keeping", zone);
    assert.equal(database.claimMemoryDiaryJob(today), null, "today must not be written as a finished daily diary");
    const skip = createDiaryService({ database: { ...database, getAppSettings: () => ({ ...database.getAppSettings(), defaultLanguageModelConfigId: modelConfig }) },
      aiRuntime: { resolveLanguageModel: () => model }, now: () => nextDay,
      generate: async () => ({ worthKeeping: false, title: "", body: "" }) });
    database.retryMemoryDiaryJobs(characterId);
    await skip.runOnce();
    await skip.runOnce();
    skip.dispose();
    assert.equal(database.getMemoryDiaryState(characterId).pending, 0);
    assert.equal(database.listMemory({ characterId, kind: "diary", query: "", offset: 0 }).entries.length, 0, "a day without useful content must not create an empty diary");

    // Restart preserves entries, revisions and pending daily work.
    const expectedRevision = database.readMemory(characterId, event.id).revision;
    database.close();
    database = openDatabase({ userDataPath: directory, appPath: process.cwd(), configValidator });
    assert.equal(database.readMemory(characterId, event.id).revision, expectedRevision);
    assert.ok(database.readMemory(characterId, person.id).forgottenAt, "forgetting must survive a restart");
    assert.equal(database.searchMemory(characterId, { query: "林同学", kind: null }).results.length, 0);
    assert.equal(database.getMemoryDiaryState(characterId).failed, 0);
    database.deleteThread(threadId, characterId);
    assert.equal(database.readMemory(characterId, event.id).content.body, "已经挑好了书。");
    database.deleteCharacter(characterId);
    assert.deepEqual(sql.prepare("SELECT count(*) AS n FROM memory_entries WHERE character_id = ?").get(characterId), { n: 0 });
    assert.equal(database.searchMemory(second.id, { query: "已经挑好", kind: null }).results.length, 0);
    assert.deepEqual(sql.pragma("foreign_key_check"), []);
    console.log("Structured memory: persistence, isolation, correction, forgetting, daily deduplication and retries passed.");
  } finally {
    sql.close(); database.close(); rmSync(directory, { recursive: true, force: true });
  }
}

function runMemorySimplificationMigration(): void {
  const directory = mkdtempSync(join(tmpdir(), "katarune-memory-migration-"));
  const sqlite = new BetterSqlite3(join(directory, "katarune.sqlite"));
  let database: ReturnType<typeof openDatabase> | undefined;
  const characterId = "00000000-0000-4000-8000-000000000091";
  const personId = "00000000-0000-4000-8000-000000000092";
  const eventId = "00000000-0000-4000-8000-000000000093";
  const diaryId = "00000000-0000-4000-8000-000000000094";
  const longEventId = "00000000-0000-4000-8000-000000000095";
  const longBody = "🙂".repeat(16_000);
  try {
    const journal = JSON.parse(readFileSync(join(process.cwd(), "drizzle/meta/_journal.json"), "utf8"));
    sqlite.pragma("foreign_keys = OFF");
    sqlite.transaction(() => {
      sqlite.exec('CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY, hash text NOT NULL, created_at numeric)');
      for (const entry of journal.entries.filter((item: { idx: number }) => item.idx <= 19)) {
        sqlite.exec(readFileSync(join(process.cwd(), "drizzle", `${entry.tag}.sql`), "utf8"));
        sqlite.prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)').run("migration-fixture", entry.when);
      }
    })();
    const stamp = Date.now();
    sqlite.prepare('INSERT INTO characters (id, name, system_prompt, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(characterId, "迁移示例", "", stamp, stamp);
    sqlite.prepare('INSERT INTO memory_diary_jobs (id, character_id, day, time_zone, status, attempts, retry_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run("legacy-failure", characterId, "2026-10-17", "Asia/Shanghai", "failed", 1, stamp);
    const insert = sqlite.prepare('INSERT INTO memory_entries (id, character_id, kind, title, body, day, is_user, status, revision, created_at, updated_at, forgotten_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    insert.run(personId, characterId, "person", "朋友", "喜欢读书。", null, 0, null, 3, stamp, stamp, null);
    insert.run(eventId, characterId, "event", "礼物", "已经挑好了书。", null, 0, "completed", 4, stamp, stamp, null);
    insert.run(longEventId, characterId, "event", "长正文", longBody, null, 0, "active", 1, stamp, stamp, null);
    insert.run(diaryId, characterId, "diary", "周末", "我想记住这一天。", "2026-10-18", 0, null, 2, stamp, stamp, stamp);
    sqlite.prepare('INSERT INTO memory_links (character_id, from_id, to_id) VALUES (?, ?, ?)').run(characterId, personId, eventId);
    sqlite.prepare('INSERT INTO memory_sources (id, entry_id, label, created_at) VALUES (?, ?, ?, ?)').run("fixture-source", eventId, "示例来源", stamp);
    database = openDatabase({ userDataPath: directory, appPath: process.cwd(), configValidator: { validateModelMetadata, validateModelSettings, validateProviderSettings } });
    assert.deepEqual(database.getMemoryDiaryState(characterId).lastFailure, { day: "2026-10-17", code: null }, "legacy failures retain their state without inventing a cause");
    assert.equal(database.readMemory(characterId, longEventId).content.body, longBody);
    assert.equal(database.readMemory(characterId, personId).content.body, "喜欢读书。");
    assert.equal(database.readMemory(characterId, eventId).content.body, "进展：已完成\n\n已经挑好了书。");
    assert.equal(database.readMemory(characterId, eventId).revision, 4);
    assert.ok(database.readMemory(characterId, diaryId).forgottenAt);
    assert.equal(database.readMemory(characterId, diaryId).content.body, "我想记住这一天。");
    assert.equal(sqlite.prepare("SELECT name FROM sqlite_master WHERE name = 'memory_links'").get(), undefined);
    assert.equal(sqlite.prepare("SELECT name FROM sqlite_master WHERE name = 'memory_sources'").get(), undefined);
    assert.deepEqual(sqlite.pragma("foreign_key_check"), []);
    console.log("Memory simplification migration preserves content, versions and forgotten state.");
  } finally { database?.close(); sqlite.close(); rmSync(directory, { recursive: true, force: true }); }
}
