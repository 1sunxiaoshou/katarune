import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import BetterSqlite3 from "better-sqlite3";
import { openDatabase, type DatabaseRuntime } from "../src/main/database/database";

const threadId = "restart-recovery-thread";
const secondThreadId = "second-character-thread";
const secondCharacterId = "33333333-3333-4333-8333-333333333333";
const message = {
  id: "restart-recovery-message",
  parent_id: null,
  format: "ai-sdk/v6",
  content: {
    role: "user",
    parts: [{ type: "text", text: "重启后仍然存在" }],
  },
} as const;
const providerConfigRequest = {
  displayName: "本地兼容端点",
  providerType: "openai-compatible",
  baseUrl: "http://127.0.0.1:1234/v1",
  settings: { supportsStructuredOutputs: false },
  enabled: true,
} as const;
const modelConfigRequest = {
  modelType: "languageModel",
  modelId: "local-chat",
  displayName: "本地聊天模型",
  settings: { temperature: 0.7, maxOutputTokens: 512 },
  enabled: true,
} as const;

const userDataPath = mkdtempSync(join(tmpdir(), "katarune-database-test-"));
const legacyUserDataPath = mkdtempSync(join(tmpdir(), "katarune-legacy-database-test-"));
const jumpUserDataPath = mkdtempSync(join(tmpdir(), "katarune-jump-database-test-"));
const deletionUserDataPath = mkdtempSync(join(tmpdir(), "katarune-character-delete-test-"));
let runtime: DatabaseRuntime | undefined;
let legacyRuntime: DatabaseRuntime | undefined;
let jumpRuntime: DatabaseRuntime | undefined;
let deletionRuntime: DatabaseRuntime | undefined;

function createLegacyProviderIdentityDatabase(): void {
  const sqlite = new BetterSqlite3(join(legacyUserDataPath, "katarune.sqlite"));
  try {
    for (const migration of [
      "0000_dapper_mother_askani.sql",
      "0001_pink_ma_gnuci.sql",
      "0002_material_callisto.sql",
      "0003_harsh_ultimatum.sql",
    ]) {
      sqlite.exec(readFileSync(join(process.cwd(), "drizzle", migration), "utf8"));
    }

    sqlite.exec(`
      CREATE TABLE "__drizzle_migrations" (
        id SERIAL PRIMARY KEY,
        hash text NOT NULL,
        created_at numeric
      );
    `);
    sqlite.prepare(
      'INSERT INTO "__drizzle_migrations" (hash, created_at) VALUES (?, ?)',
    ).run("legacy-local-0004", 1784651121363);

    sqlite.prepare(`
      INSERT INTO provider_configs (
        id, registry_id, display_name, provider_type, base_url, credential_ref,
        settings, enabled, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "11111111-1111-4111-8111-111111111111",
      "legacy-local",
      "旧本地端点",
      "openai-compatible",
      "http://127.0.0.1:1234/v1",
      null,
      null,
      1,
      1784651121363,
      1784651121363,
    );
    sqlite.prepare(`
      INSERT INTO model_configs (
        id, provider_config_id, model_id, display_name, settings, enabled, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "22222222-2222-4222-8222-222222222222",
      "11111111-1111-4111-8111-111111111111",
      "legacy-chat",
      "旧本地模型",
      null,
      1,
      1784651121363,
      1784651121363,
    );

    sqlite.exec(`
      DROP INDEX provider_configs_registry_id_unique;
      ALTER TABLE provider_configs DROP COLUMN registry_id;
    `);
  } finally {
    sqlite.close();
  }
}

function createCharacterlessThreadDatabaseAtMigrationSix(): void {
  const sqlite = new BetterSqlite3(join(jumpUserDataPath, "katarune.sqlite"));
  try {
    for (const migration of [
      "0000_dapper_mother_askani.sql",
      "0001_pink_ma_gnuci.sql",
      "0002_material_callisto.sql",
      "0003_harsh_ultimatum.sql",
      "0004_chilly_night_nurse.sql",
      "0005_harsh_fallen_one.sql",
      "0006_tired_lake.sql",
    ]) {
      sqlite.exec(readFileSync(join(process.cwd(), "drizzle", migration), "utf8"));
    }
    sqlite.exec(`
      CREATE TABLE "__drizzle_migrations" (
        id SERIAL PRIMARY KEY,
        hash text NOT NULL,
        created_at numeric
      );
    `);
    sqlite
      .prepare('INSERT INTO "__drizzle_migrations" (hash, created_at) VALUES (?, ?)')
      .run("migration-six", 1784802064304);
    sqlite
      .prepare(
        "INSERT INTO threads (id, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run("orphaned-legacy-thread", "跳跃升级线程", "regular", Date.now(), Date.now());
  } finally {
    sqlite.close();
  }
}

try {
  runtime = openDatabase({ userDataPath, appPath: process.cwd() });
  const initialCharacterId = runtime.getAppState().activeCharacter.id;
  runtime.initializeThread(threadId, initialCharacterId);
  runtime.appendThreadMessage({ threadId, characterId: initialCharacterId, message });
  const providerConfig = runtime.createProviderConfig(providerConfigRequest);
  const duplicateProviderConfig = runtime.createProviderConfig(providerConfigRequest);
  assert.notEqual(duplicateProviderConfig.id, providerConfig.id);
  runtime.deleteProviderConfig(duplicateProviderConfig.id);
  const modelConfig = runtime.createModelConfig({
    providerConfigId: providerConfig.id,
    ...modelConfigRequest,
  });
  assert.throws(
    () =>
      runtime?.createModelConfig({
        providerConfigId: providerConfig.id,
        ...modelConfigRequest,
      }),
    /already exists/,
  );
  assert.throws(
    () => runtime?.createModelConfig({
      providerConfigId: providerConfig.id,
      ...modelConfigRequest,
      modelType: "embeddingModel",
    }),
    /already exists/,
    "同一 Provider 下的 modelId 只能配置一次",
  );
  const defaultCharacter = runtime.listCharacters().characters[0];
  assert.ok(defaultCharacter);
  assert.equal(defaultCharacter.name, "春原心奈");
  assert.equal(defaultCharacter.modelConfigId, null);
  const updatedCharacter = runtime.updateCharacter({
    id: defaultCharacter.id,
    name: "数据库中的星澜",
    modelConfigId: modelConfig.id,
    systemPrompt: "数据库配置优先于默认配置。",
  });
  assert.equal(updatedCharacter.name, "数据库中的星澜");
  runtime.close();
  runtime = undefined;

  const setupSqlite = new BetterSqlite3(join(userDataPath, "katarune.sqlite"));
  try {
    setupSqlite.pragma("foreign_keys = ON");
    setupSqlite
      .prepare(`
        INSERT INTO characters (
          id, name, portrait_asset_id, model_config_id, system_prompt, created_at, updated_at
        ) VALUES (?, ?, NULL, NULL, ?, ?, ?)
      `)
      .run(secondCharacterId, "月影", "你是月影。", Date.now(), Date.now());
  } finally {
    setupSqlite.close();
  }

  runtime = openDatabase({ userDataPath, appPath: process.cwd() });
  const restoredCharacterId = runtime.getAppState().activeCharacter.id;
  assert.equal(runtime.fetchThread(threadId, restoredCharacterId).remoteId, threadId);
  assert.deepEqual(runtime.loadThreadMessages(threadId, restoredCharacterId).messages, [message]);
  assert.deepEqual(runtime.fetchProviderConfig(providerConfig.id), providerConfig);
  assert.deepEqual(runtime.listProviderConfigs().providerConfigs, [providerConfig]);
  assert.deepEqual(runtime.fetchModelConfig(modelConfig.id), modelConfig);
  assert.deepEqual(runtime.listModelConfigs().modelConfigs, [modelConfig]);
  assert.deepEqual(runtime.fetchCharacter(updatedCharacter.id), updatedCharacter);
  assert.equal(
    runtime
      .listCharacters()
      .characters.find((candidate) => candidate.id === updatedCharacter.id)?.name,
    "数据库中的星澜",
  );
  assert.equal(runtime.getAppState().activeCharacter.id, restoredCharacterId);
  const initialLastMessageAt = runtime.fetchThread(
    threadId,
    restoredCharacterId,
  ).lastMessageAt;
  await new Promise((resolve) => setTimeout(resolve, 5));
  runtime.renameThread(threadId, restoredCharacterId, "不会改变消息排序");
  assert.equal(
    runtime.fetchThread(threadId, restoredCharacterId).lastMessageAt.getTime(),
    initialLastMessageAt.getTime(),
    "重命名不应改变最近消息时间",
  );

  const orderingThreadId = "newer-message-ordering-thread";
  runtime.initializeThread(orderingThreadId, restoredCharacterId);
  await new Promise((resolve) => setTimeout(resolve, 5));
  runtime.appendThreadMessage({
    threadId: orderingThreadId,
    characterId: restoredCharacterId,
    message: { ...message, id: "newer-message-ordering-message" },
  });
  assert.equal(
    runtime.listThreads(restoredCharacterId).threads[0]?.remoteId,
    orderingThreadId,
    "会话应按最近消息活动排序",
  );
  await new Promise((resolve) => setTimeout(resolve, 5));
  runtime.renameThread(threadId, restoredCharacterId, "重命名仍不置顶");
  assert.equal(
    runtime.listThreads(restoredCharacterId).threads[0]?.remoteId,
    orderingThreadId,
    "旧会话重命名后不应抢占最近消息会话的位置",
  );
  runtime.deleteThread(orderingThreadId, restoredCharacterId);

  runtime.initializeThread(secondThreadId, secondCharacterId);
  assert.deepEqual(
    runtime.listThreads(restoredCharacterId).threads.map((thread) => thread.remoteId),
    [threadId],
  );
  assert.deepEqual(
    runtime.listThreads(secondCharacterId).threads.map((thread) => thread.remoteId),
    [secondThreadId],
  );
  assert.throws(
    () => runtime?.fetchThread(secondThreadId, restoredCharacterId),
    /not found/,
  );
  runtime.setActiveCharacter(secondCharacterId);
  runtime.close();
  runtime = openDatabase({ userDataPath, appPath: process.cwd() });
  assert.equal(runtime.getAppState().activeCharacter.id, secondCharacterId);
  runtime.setThreadStatus(threadId, restoredCharacterId, "archived");
  assert.equal(
    runtime.fetchThread(threadId, restoredCharacterId).status,
    "archived",
  );
  assert.deepEqual(
    runtime.listThreads(restoredCharacterId).threads.map((thread) => ({
      id: thread.remoteId,
      status: thread.status,
    })),
    [{ id: threadId, status: "archived" }],
  );
  assert.deepEqual(
    runtime.listThreads(secondCharacterId).threads.map((thread) => thread.remoteId),
    [secondThreadId],
  );
  runtime.close();
  runtime = openDatabase({ userDataPath, appPath: process.cwd() });
  assert.equal(
    runtime.fetchThread(threadId, restoredCharacterId).status,
    "archived",
    "归档状态应跨重启恢复",
  );
  runtime.setThreadStatus(threadId, restoredCharacterId, "regular");
  assert.equal(
    runtime.fetchThread(threadId, restoredCharacterId).status,
    "regular",
  );

  const credentialReference = "safe-storage/12345678-1234-4123-8123-123456789abc";
  const providerWithCredential = runtime.setProviderCredentialReference(
    providerConfig.id,
    credentialReference,
  );
  assert.equal(providerWithCredential.credentialRef, credentialReference);

  const updatedModelConfig = runtime.updateModelConfig({
    id: modelConfig.id,
    modelType: "embeddingModel",
    modelId: "local-chat-updated",
    displayName: null,
    settings: { temperature: 0.2 },
    enabled: false,
  });
  assert.equal(updatedModelConfig.providerConfigId, providerConfig.id);
  assert.equal(updatedModelConfig.modelType, "embeddingModel");
  assert.equal(updatedModelConfig.modelId, "local-chat-updated");
  assert.equal(updatedModelConfig.enabled, false);

  const updatedProviderConfig = runtime.updateProviderConfig({
    id: providerConfig.id,
    displayName: "已更新的兼容端点",
    baseUrl: providerConfig.baseUrl,
    settings: providerConfig.settings,
    enabled: false,
  });
  assert.equal(updatedProviderConfig.credentialRef, credentialReference);
  assert.equal(updatedProviderConfig.enabled, false);

  runtime.deleteThread(threadId, restoredCharacterId);
  assert.throws(
    () => runtime?.loadThreadMessages(threadId, restoredCharacterId),
    /not found/,
  );
  runtime.deleteProviderConfig(providerConfig.id);
  assert.deepEqual(runtime.listProviderConfigs().providerConfigs, []);
  assert.deepEqual(runtime.listModelConfigs().modelConfigs, []);
  assert.equal(
    runtime.fetchCharacter(updatedCharacter.id).modelConfigId,
    modelConfig.id,
    "角色应保留已失效的模型引用，供 UI 显示不可用状态",
  );
  runtime.deleteThread(secondThreadId, secondCharacterId);
  runtime.close();
  runtime = undefined;

  const constrainedSqlite = new BetterSqlite3(join(userDataPath, "katarune.sqlite"));
  try {
    constrainedSqlite.pragma("foreign_keys = ON");
    assert.throws(
      () =>
        constrainedSqlite
          .prepare("DELETE FROM characters WHERE id = ?")
          .run(secondCharacterId),
      /FOREIGN KEY constraint failed/,
      "active_character_id must restrict deleting the selected character",
    );
    assert.throws(
      () =>
        constrainedSqlite
          .prepare("DELETE FROM assets WHERE id = ?")
          .run("00000000-0000-4000-8000-000000000002"),
      /FOREIGN KEY constraint failed/,
      "portrait_asset_id must restrict deleting an attached asset",
    );
    assert.deepEqual(constrainedSqlite.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    constrainedSqlite.close();
  }

  createLegacyProviderIdentityDatabase();
  legacyRuntime = openDatabase({ userDataPath: legacyUserDataPath, appPath: process.cwd() });
  const migratedProvider = legacyRuntime.fetchProviderConfig(
    "11111111-1111-4111-8111-111111111111",
  );
  const migratedModel = legacyRuntime.fetchModelConfig(
    "22222222-2222-4222-8222-222222222222",
  );
  assert.equal(migratedProvider.displayName, "旧本地端点");
  assert.equal(migratedModel.modelType, "languageModel");
  assert.equal(migratedModel.providerConfigId, migratedProvider.id);
  legacyRuntime.close();
  legacyRuntime = undefined;

  const migratedSqlite = new BetterSqlite3(join(legacyUserDataPath, "katarune.sqlite"), {
    readonly: true,
  });
  try {
    const providerColumns = migratedSqlite
      .prepare<[], { name: string }>("PRAGMA table_info(provider_configs)")
      .all()
      .map((column) => column.name);
    assert.equal(providerColumns.includes("registry_id"), false);
    assert.deepEqual(migratedSqlite.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    migratedSqlite.close();
  }

  createCharacterlessThreadDatabaseAtMigrationSix();
  jumpRuntime = openDatabase({ userDataPath: jumpUserDataPath, appPath: process.cwd() });
  const bootstrappedCharacter = jumpRuntime.getAppState().activeCharacter;
  assert.equal(bootstrappedCharacter.id, "00000000-0000-4000-8000-000000000001");
  assert.equal(
    jumpRuntime.fetchThread("orphaned-legacy-thread", bootstrappedCharacter.id).characterId,
    bootstrappedCharacter.id,
  );
  assert.equal(
    jumpRuntime.fetchAsset("00000000-0000-4000-8000-000000000002").status,
    "missing",
  );
  jumpRuntime.close();
  jumpRuntime = undefined;

  const jumpSqlite = new BetterSqlite3(join(jumpUserDataPath, "katarune.sqlite"), {
    readonly: true,
  });
  try {
    assert.deepEqual(jumpSqlite.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    jumpSqlite.close();
  }

  deletionRuntime = openDatabase({
    userDataPath: deletionUserDataPath,
    appPath: process.cwd(),
  });
  const deletionDefault = deletionRuntime.getAppState().activeCharacter;
  assert.throws(
    () => deletionRuntime?.deleteCharacter(deletionDefault.id),
    /至少需要保留一个角色/,
  );
  assert.equal(
    deletionRuntime.getAppState().activeCharacter.id,
    deletionDefault.id,
    "拒绝删除唯一角色后应保持活动角色",
  );
  assert.equal(deletionRuntime.listCharacters().characters.length, 1);

  const createdCharacter = deletionRuntime.createCharacter({
    name: "未命名角色",
    modelConfigId: null,
    systemPrompt: "",
  });
  assert.equal(createdCharacter.name, "未命名角色");
  assert.equal(createdCharacter.modelConfigId, null);
  assert.equal(createdCharacter.portraitAssetId, null);
  assert.equal(createdCharacter.systemPrompt, "");
  const secondCreatedCharacter = deletionRuntime.createCharacter({
    name: "未命名角色",
    modelConfigId: null,
    systemPrompt: "",
  });
  assert.deepEqual(
    deletionRuntime.listCharacters().characters.map((character) => character.id),
    [secondCreatedCharacter.id, createdCharacter.id, deletionDefault.id],
    "快速连续创建仍应稳定插入角色列表顶部",
  );

  const nonActiveThreadId = "non-active-character-thread";
  deletionRuntime.initializeThread(nonActiveThreadId, secondCreatedCharacter.id);
  deletionRuntime.appendThreadMessage({
    threadId: nonActiveThreadId,
    characterId: secondCreatedCharacter.id,
    message: { ...message, id: "non-active-character-message" },
  });
  const nonActiveDelete = deletionRuntime.deleteCharacter(secondCreatedCharacter.id);
  assert.equal(nonActiveDelete.deletedThreadCount, 1);
  assert.equal(nonActiveDelete.replacementCharacter.id, createdCharacter.id);
  assert.equal(nonActiveDelete.activeCharacter.id, deletionDefault.id);
  assert.throws(
    () => deletionRuntime?.loadThreadMessages(nonActiveThreadId, secondCreatedCharacter.id),
    /not found/,
  );

  const regularDeleteThreadId = "active-character-regular-thread";
  const archivedDeleteThreadId = "active-character-archived-thread";
  deletionRuntime.initializeThread(regularDeleteThreadId, deletionDefault.id);
  deletionRuntime.initializeThread(archivedDeleteThreadId, deletionDefault.id);
  deletionRuntime.setThreadStatus(archivedDeleteThreadId, deletionDefault.id, "archived");
  deletionRuntime.appendThreadMessage({
    threadId: regularDeleteThreadId,
    characterId: deletionDefault.id,
    message: { ...message, id: "active-character-message" },
  });
  const activeDelete = deletionRuntime.deleteCharacter(deletionDefault.id);
  assert.equal(activeDelete.deletedThreadCount, 2);
  assert.equal(activeDelete.replacementCharacter.id, createdCharacter.id);
  assert.equal(activeDelete.activeCharacter.id, createdCharacter.id);
  assert.equal(deletionRuntime.getAppState().activeCharacter.id, createdCharacter.id);
  assert.throws(() => deletionRuntime?.fetchCharacter(deletionDefault.id), /not found/);
  assert.throws(
    () => deletionRuntime?.loadThreadMessages(regularDeleteThreadId, deletionDefault.id),
    /not found/,
  );
  assert.equal(
    deletionRuntime.fetchAsset("00000000-0000-4000-8000-000000000002").id,
    "00000000-0000-4000-8000-000000000002",
    "删除角色后应保留其立绘资产记录",
  );
  deletionRuntime.close();
  deletionRuntime = undefined;
  const deletionSqlite = new BetterSqlite3(
    join(deletionUserDataPath, "katarune.sqlite"),
    { readonly: true },
  );
  try {
    const deletedMessageCount = deletionSqlite
      .prepare<[string, string], { count: number }>(
        "SELECT COUNT(*) AS count FROM messages WHERE id IN (?, ?)",
      )
      .get("non-active-character-message", "active-character-message");
    assert.equal(
      deletedMessageCount?.count,
      0,
      "删除角色时线程消息应通过外键级联清理",
    );
    assert.deepEqual(deletionSqlite.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    deletionSqlite.close();
  }

  console.log(
    "SQLite thread, message, Provider/model/character config, and legacy migration recovery passed.",
  );
} finally {
  runtime?.close();
  legacyRuntime?.close();
  jumpRuntime?.close();
  deletionRuntime?.close();
  rmSync(userDataPath, { recursive: true, force: true });
  rmSync(legacyUserDataPath, { recursive: true, force: true });
  rmSync(jumpUserDataPath, { recursive: true, force: true });
  rmSync(deletionUserDataPath, { recursive: true, force: true });
}
