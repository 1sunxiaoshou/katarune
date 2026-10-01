import { emptyAppSettings } from "./defaultSettings";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import BetterSqlite3 from "better-sqlite3";
import {
  validateModelMetadata,
  validateModelSettings,
  validateProviderSettings,
} from "../src/main/ai/providerDefinitions";
import { openDatabase, type DatabaseRuntime } from "../src/main/database/database";

const configValidator = {
  validateModelMetadata,
  validateModelSettings,
  validateProviderSettings,
};

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
  metadata: null,
  settings: { temperature: 0.7, maxOutputTokens: 512 },
  enabled: true,
} as const;

const userDataPath = mkdtempSync(join(tmpdir(), "katarune-database-test-"));
const legacyUserDataPath = mkdtempSync(join(tmpdir(), "katarune-legacy-database-test-"));
const jumpUserDataPath = mkdtempSync(join(tmpdir(), "katarune-jump-database-test-"));
const speechMigrationUserDataPath = mkdtempSync(
  join(tmpdir(), "katarune-speech-migration-test-"),
);
const deletionUserDataPath = mkdtempSync(join(tmpdir(), "katarune-character-delete-test-"));
let runtime: DatabaseRuntime | undefined;
let legacyRuntime: DatabaseRuntime | undefined;
let jumpRuntime: DatabaseRuntime | undefined;
let speechMigrationRuntime: DatabaseRuntime | undefined;
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

function createSpeechModelDatabaseAtMigrationEleven(): void {
  const sqlite = new BetterSqlite3(
    join(speechMigrationUserDataPath, "katarune.sqlite"),
  );
  try {
    for (const migration of [
      "0000_dapper_mother_askani.sql",
      "0001_pink_ma_gnuci.sql",
      "0002_material_callisto.sql",
      "0003_harsh_ultimatum.sql",
      "0004_chilly_night_nurse.sql",
      "0005_harsh_fallen_one.sql",
      "0006_tired_lake.sql",
      "0007_hesitant_amazoness.sql",
      "0008_conscious_sauron.sql",
      "0009_misty_doomsday.sql",
      "0010_nosy_the_enforcers.sql",
      "0011_many_lizard.sql",
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
      .run("migration-eleven", 1785487335537);
    sqlite.prepare(`
      INSERT INTO provider_configs (
        id, display_name, provider_type, base_url, credential_ref,
        settings, enabled, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "44444444-4444-4444-8444-444444444444",
      "OpenAI migration fixture",
      "openai",
      null,
      null,
      null,
      1,
      1785487335537,
      1785487335537,
    );
    sqlite.prepare(`
      INSERT INTO model_configs (
        id, provider_config_id, model_type, model_id, display_name,
        speech_metadata, settings, enabled, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "55555555-5555-4555-8555-555555555555",
      "44444444-4444-4444-8444-444444444444",
      "speechModel",
      "gpt-4o-mini-tts",
      "Migrated speech model",
      JSON.stringify({
        voices: [{ id: "alloy", displayName: "Alloy" }],
        defaultVoiceId: "manual-voice",
      }),
      null,
      1,
      1785487335537,
      1785487335537,
    );
  } finally {
    sqlite.close();
  }
}

try {
  runtime = openDatabase({
    userDataPath,
    appPath: process.cwd(),
    configValidator,
  });
  assert.deepEqual(runtime.getAppSettings(), emptyAppSettings);
  const initialCharacterId = runtime.getAppState().activeCharacter.id;
  runtime.initializeThread(threadId, initialCharacterId);
  runtime.appendThreadMessage({
    threadId,
    characterId: initialCharacterId,
    message,
    assetIds: [],
  });
  const attachmentId = "55555555-5555-4555-8555-555555555555";
  runtime.registerReadyAsset({
    id: attachmentId,
    kind: "chat_attachment",
    storageKey: attachmentId,
    mimeType: "application/octet-stream",
    byteSize: 4,
    sha256: "b".repeat(64),
    originalName: "测试附件.bin",
  });
  runtime.appendThreadMessage({
    threadId,
    characterId: initialCharacterId,
    message: {
      id: "message-with-attachment",
      parent_id: message.id,
      format: "ai-sdk/v6",
      content: {
        role: "user",
        parts: [
          {
            type: "file",
            mediaType: "application/octet-stream",
            filename: "测试附件.bin",
            url: `katarune-asset://asset/${attachmentId}`,
          },
        ],
      },
    },
    assetIds: [attachmentId],
  });
  assert.equal(
    runtime.deleteUnreferencedChatAttachment(attachmentId),
    false,
    "消息引用存在时不得释放附件",
  );
  assert.equal(
    runtime.fetchThreadChatAttachment(
      threadId,
      initialCharacterId,
      attachmentId,
    ).id,
    attachmentId,
    "历史图片工具应只能通过会话范围查询附件",
  );
  assert.throws(
    () =>
      runtime?.fetchThreadChatAttachment(
        "another-thread",
        initialCharacterId,
        attachmentId,
      ),
    /not found/,
  );
  assert.deepEqual(
    runtime.deleteThreadMessages(threadId, initialCharacterId, [
      "message-with-attachment",
    ]),
    [attachmentId],
    "删除消息只应返回本次可能失去引用的附件",
  );
  assert.equal(
    runtime.deleteUnreferencedChatAttachment(attachmentId),
    true,
    "消息删除后应允许释放无引用附件",
  );
  const persistentAttachmentId = "66666666-6666-4666-8666-666666666666";
  runtime.registerReadyAsset({
    id: persistentAttachmentId,
    kind: "chat_attachment",
    storageKey: persistentAttachmentId,
    mimeType: "image/png",
    byteSize: 4,
    sha256: "c".repeat(64),
    originalName: "重启恢复.png",
  });
  runtime.appendThreadMessage({
    threadId,
    characterId: initialCharacterId,
    message: {
      id: "persistent-attachment-message",
      parent_id: message.id,
      format: "ai-sdk/v6",
      content: {
        role: "user",
        parts: [
          {
            type: "file",
            mediaType: "image/png",
            filename: "重启恢复.png",
            url: `katarune-asset://asset/${persistentAttachmentId}`,
          },
        ],
      },
    },
    assetIds: [persistentAttachmentId],
  });
  const oversizedAttachmentId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  runtime.registerReadyAsset({
    id: oversizedAttachmentId,
    kind: "chat_attachment",
    storageKey: oversizedAttachmentId,
    mimeType: "application/octet-stream",
    byteSize: 25 * 1024 * 1024 + 1,
    sha256: "e".repeat(64),
    originalName: "oversized.bin",
  });
  assert.throws(
    () =>
      runtime?.appendThreadMessage({
        threadId,
        characterId: initialCharacterId,
        message: { ...message, id: "oversized-attachment-message" },
        assetIds: [oversizedAttachmentId],
      }),
    /不可用/,
    "消息事务必须复验单文件大小",
  );
  assert.equal(runtime.deleteUnreferencedChatAttachment(oversizedAttachmentId), true);

  const totalLimitAttachmentIds = [
    "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  ];
  for (const id of totalLimitAttachmentIds) {
    runtime.registerReadyAsset({
      id,
      kind: "chat_attachment",
      storageKey: id,
      mimeType: "application/octet-stream",
      byteSize: 20 * 1024 * 1024,
      sha256: "f".repeat(64),
      originalName: `${id}.bin`,
    });
  }
  assert.throws(
    () =>
      runtime?.appendThreadMessage({
        threadId,
        characterId: initialCharacterId,
        message: { ...message, id: "total-limit-attachment-message" },
        assetIds: totalLimitAttachmentIds,
      }),
    /50 MiB/,
    "消息事务必须复验附件总大小",
  );
  for (const id of totalLimitAttachmentIds) {
    assert.equal(runtime.deleteUnreferencedChatAttachment(id), true);
  }
  const providerConfig = runtime.createProviderConfig(providerConfigRequest);
  assert.throws(
    () =>
      runtime?.createProviderConfig({
        ...providerConfigRequest,
        displayName: "非法设置供应商",
        settings: { apiKey: "must-not-be-persisted" },
      }),
    /unrecognized|Invalid input/i,
    "Provider Definition 必须在持久化前拒绝未声明设置",
  );
  const duplicateProviderConfig = runtime.createProviderConfig(providerConfigRequest);
  assert.notEqual(duplicateProviderConfig.id, providerConfig.id);
  runtime.deleteProviderConfig(duplicateProviderConfig.id);
  const modelConfig = runtime.createModelConfig({
    providerConfigId: providerConfig.id,
    ...modelConfigRequest,
  });
  const speechModelConfig = runtime.createModelConfig({
    providerConfigId: providerConfig.id,
    modelType: "speechModel",
    modelId: "gpt-4o-mini-tts",
    displayName: "测试声音模型",
    metadata: {
      voices: [{ id: "alloy", displayName: "Alloy" }],
    },
    settings: { defaultVoiceId: "alloy" },
    enabled: true,
  });
  assert.throws(
    () =>
      runtime?.updateAppSettings({
        defaultLanguageModelConfigId: speechModelConfig.id,
      }),
    /语言模型/,
  );
  assert.deepEqual(
    runtime.updateAppSettings({
      defaultLanguageModelConfigId: modelConfig.id,
    }),
    { ...emptyAppSettings, defaultLanguageModelConfigId: modelConfig.id },
  );
  assert.throws(() => runtime?.updateAppSettings({ defaultSpeechModelConfigId: modelConfig.id }), /语音/);
  runtime.updateAppSettings({ defaultSpeechModelConfigId: speechModelConfig.id, defaultSpeechVoice: "alloy" });
  runtime.updateAppSettings({ defaultAsrModel: null });
  assert.equal(runtime.getAppSettings().defaultSpeechVoice, "alloy");
  assert.equal(runtime.getAppSettings().defaultAsrModel, "sensevoice-small-int8");
  runtime.updateAppSettings({ defaultAsrModel: "sensevoice-small-int8" });
  assert.equal(runtime.fetchCharacter(initialCharacterId).useDefaultSpeechModel, false);
  const inherited = runtime.updateCharacter({ id: initialCharacterId, useDefaultSpeechModel: true, useDefaultSpeechVoice: true });
  assert.equal(inherited.useDefaultSpeechVoice, true);
  runtime.updateCharacter({ id: initialCharacterId, useDefaultSpeechModel: false, useDefaultSpeechVoice: false });
  assert.throws(
    () =>
      runtime?.createModelConfig({
        providerConfigId: providerConfig.id,
        modelType: "languageModel",
        modelId: "invalid-language-settings",
        displayName: null,
        metadata: null,
        settings: { topP: 2 },
        enabled: true,
      }),
    /too big|Invalid input/i,
    "Language Capability Schema 必须在持久化前校验 settings",
  );
  assert.throws(
    () =>
      runtime?.createModelConfig({
        providerConfigId: providerConfig.id,
        modelType: "speechModel",
        modelId: "invalid-speech-settings",
        displayName: null,
        metadata: null,
        settings: { temperature: 0.2 },
        enabled: true,
      }),
    /Invalid input/i,
    "Speech Capability Schema 必须拒绝未声明的 settings",
  );
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
      settings: null,
    }),
    /already exists/,
    "同一 Provider 下的 modelId 只能配置一次",
  );
  const defaultCharacter = runtime.listCharacters().characters[0];
  assert.ok(defaultCharacter);
  assert.equal(defaultCharacter.name, "春原心奈");
  assert.equal(defaultCharacter.modelConfigId, null);
  assert.equal(defaultCharacter.speechModelConfigId, null);
  assert.equal(defaultCharacter.speechVoice, null);
  let updatedCharacter = runtime.updateCharacter({
    id: defaultCharacter.id,
    name: "数据库中的星澜",
    modelConfigId: modelConfig.id,
    speechModelConfigId: speechModelConfig.id,
    speechVoice: "alloy",
    systemPrompt: "数据库配置优先于默认配置。",
  });
  assert.equal(updatedCharacter.name, "数据库中的星澜");
  updatedCharacter = runtime.updateCharacter({
    id: defaultCharacter.id,
    speechModelConfigId: speechModelConfig.id,
    speechVoice: "not-in-catalog",
  });
  assert.equal(updatedCharacter.speechVoice, "not-in-catalog");
  assert.throws(
    () =>
      runtime?.updateCharacter({
        id: defaultCharacter.id,
        speechModelConfigId: null,
      }),
    /同时配置或同时清空/,
  );
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

  runtime = openDatabase({
    userDataPath,
    appPath: process.cwd(),
    configValidator,
  });
  assert.deepEqual(runtime.getAppSettings(), {
    ...emptyAppSettings,
    defaultSpeechModelConfigId: speechModelConfig.id, defaultSpeechVoice: "alloy",
    defaultLanguageModelConfigId: modelConfig.id,
  });
  const restoredCharacterId = runtime.getAppState().activeCharacter.id;
  assert.equal(
    runtime.fetchAsset("00000000-0000-4000-8000-000000000002").kind,
    "character_portrait",
    "历史资产迁移后应回填为立绘类别",
  );
  assert.equal(
    runtime.deleteUnreferencedChatAttachment(persistentAttachmentId),
    false,
    "重启后消息引用仍应保护附件",
  );
  assert.match(
    JSON.stringify(runtime.loadThreadMessages(threadId, restoredCharacterId)),
    new RegExp(persistentAttachmentId),
    "重启后消息应恢复托管附件 URL",
  );
  assert.equal(runtime.fetchThread(threadId, restoredCharacterId).remoteId, threadId);
  const restoredMessages = runtime.loadThreadMessages(
    threadId,
    restoredCharacterId,
  ).messages;
  assert.equal(restoredMessages.length, 2);
  assert.deepEqual(restoredMessages[0], message);
  assert.deepEqual(runtime.fetchProviderConfig(providerConfig.id), providerConfig);
  assert.deepEqual(runtime.listProviderConfigs().providerConfigs, [providerConfig]);
  assert.deepEqual(runtime.fetchModelConfig(modelConfig.id), modelConfig);
  assert.deepEqual(runtime.fetchModelConfig(speechModelConfig.id), speechModelConfig);
  assert.deepEqual(runtime.listModelConfigs().modelConfigs, [
    modelConfig,
    speechModelConfig,
  ]);
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
    assetIds: [],
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
  runtime = openDatabase({
    userDataPath,
    appPath: process.cwd(),
    configValidator,
  });
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
  runtime = openDatabase({
    userDataPath,
    appPath: process.cwd(),
    configValidator,
  });
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
    metadata: null,
    settings: null,
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

  assert.deepEqual(
    runtime.deleteThread(threadId, restoredCharacterId),
    [persistentAttachmentId],
    "删除会话只应返回该会话引用过的附件",
  );
  assert.throws(
    () => runtime?.loadThreadMessages(threadId, restoredCharacterId),
    /not found/,
  );
  runtime.deleteProviderConfig(providerConfig.id);
  assert.deepEqual(runtime.listProviderConfigs().providerConfigs, []);
  assert.deepEqual(runtime.listModelConfigs().modelConfigs, []);
  assert.deepEqual(
    runtime.getAppSettings(),
    emptyAppSettings,
    "删除默认模型所属 Provider 后应由外键自动清空应用默认模型",
  );
  assert.equal(
    runtime.fetchCharacter(updatedCharacter.id).modelConfigId,
    modelConfig.id,
    "角色应保留已失效的模型引用，供 UI 显示不可用状态",
  );
  assert.equal(
    runtime.fetchCharacter(updatedCharacter.id).speechModelConfigId,
    speechModelConfig.id,
    "角色应保留已失效的声音模型引用，供 UI 显示不可用状态",
  );
  assert.equal(
    runtime.fetchCharacter(updatedCharacter.id).speechVoice,
    "not-in-catalog",
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
  legacyRuntime = openDatabase({
    userDataPath: legacyUserDataPath,
    appPath: process.cwd(),
    configValidator,
  });
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
  jumpRuntime = openDatabase({
    userDataPath: jumpUserDataPath,
    appPath: process.cwd(),
    configValidator,
  });
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

  createSpeechModelDatabaseAtMigrationEleven();
  speechMigrationRuntime = openDatabase({
    userDataPath: speechMigrationUserDataPath,
    appPath: process.cwd(),
    configValidator,
  });
  const migratedSpeechModel = speechMigrationRuntime.fetchModelConfig(
    "55555555-5555-4555-8555-555555555555",
  );
  assert.deepEqual(migratedSpeechModel.metadata, {
    voices: [{ id: "alloy", displayName: "Alloy" }],
  });
  assert.deepEqual(migratedSpeechModel.settings, {
    defaultVoiceId: "manual-voice",
  });
  speechMigrationRuntime.close();
  speechMigrationRuntime = undefined;

  deletionRuntime = openDatabase({
    userDataPath: deletionUserDataPath,
    appPath: process.cwd(),
    configValidator,
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
    speechModelConfigId: null,
    speechVoice: null,
    systemPrompt: "",
  });
  assert.equal(createdCharacter.name, "未命名角色");
  assert.equal(createdCharacter.modelConfigId, null);
  assert.equal(createdCharacter.portraitAssetId, null);
  assert.equal(createdCharacter.systemPrompt, "");
  const secondCreatedCharacter = deletionRuntime.createCharacter({
    name: "未命名角色",
    modelConfigId: null,
    speechModelConfigId: null,
    speechVoice: null,
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
    assetIds: [],
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
    assetIds: [],
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

  // Reproduce local 0014: identical SQL was journaled with an earlier timestamp.
  deletionRuntime = openDatabase({ userDataPath: deletionUserDataPath, appPath: process.cwd(), configValidator });
  deletionRuntime.close();
  deletionRuntime = undefined;
  const historyPath = join(deletionUserDataPath, "katarune.sqlite");
  const attachmentHash = "6a84178de374807e4565e5f6d9346f718a248e98dff0bcc3d21865191a4c9fc4";
  function readApplicationRows(sqlite: BetterSqlite3.Database): unknown {
    const tables = sqlite.prepare<[], { name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name != '__drizzle_migrations' ORDER BY name",
    ).all();
    return tables.map(({ name }) => ({
      name,
      rows: sqlite.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}" ORDER BY rowid`).all(),
    }));
  }
  const historySqlite = new BetterSqlite3(historyPath);
  let originalRows: unknown;
  let migrationCount: unknown;
  try {
    // A replay would incorrectly rewrite this attachment as a portrait.
    historySqlite.prepare(
      "INSERT INTO assets (id, kind, storage_key, status, created_at, updated_at) VALUES (?, 'chat_attachment', ?, 'missing', 1, 1)",
    ).run("migration-attachment", "migration-attachment");
    historySqlite.prepare(
      "INSERT INTO threads (id, character_id, title, created_at, updated_at) SELECT 'migration-thread', id, 'Migration fixture', 1, 1 FROM characters LIMIT 1",
    ).run();
    historySqlite.prepare(
      "INSERT INTO messages (id, thread_id, format, content, created_at) SELECT 'migration-message', id, 'ai-sdk/v6', '{}', 1 FROM threads LIMIT 1",
    ).run();
    historySqlite.prepare(
      "INSERT INTO message_assets (message_id, asset_id) VALUES ('migration-message', 'migration-attachment')",
    ).run();
    originalRows = readApplicationRows(historySqlite);
    migrationCount = historySqlite.prepare("SELECT count(*) AS count FROM __drizzle_migrations").get();
    assert.equal(historySqlite.prepare(
      "UPDATE __drizzle_migrations SET created_at = 1785685134232 WHERE hash = ? AND created_at = 1785688523544",
    ).run(attachmentHash).changes, 1);
  } finally {
    historySqlite.close();
  }
  for (let restart = 0; restart < 2; restart++) {
    deletionRuntime = openDatabase({ userDataPath: deletionUserDataPath, appPath: process.cwd(), configValidator });
    deletionRuntime.close();
    deletionRuntime = undefined;
    const check = new BetterSqlite3(historyPath, { readonly: true });
    try {
      assert.deepEqual(readApplicationRows(check), originalRows);
      assert.deepEqual(check.prepare("SELECT count(*) AS count FROM __drizzle_migrations").get(), migrationCount);
      assert.deepEqual(check.prepare("SELECT created_at FROM __drizzle_migrations WHERE hash = ?").get(attachmentHash), { created_at: 1785688523544 });
      assert.deepEqual(check.pragma("foreign_key_check"), []);
    } finally {
      check.close();
    }
  }
  const unknownHistory = new BetterSqlite3(historyPath);
  try {
    unknownHistory.prepare(
      "UPDATE __drizzle_migrations SET hash = 'unknown-sql', created_at = 1785685134232 WHERE hash = ?",
    ).run(attachmentHash);
  } finally {
    unknownHistory.close();
  }
  assert.throws(() => openDatabase({ userDataPath: deletionUserDataPath, appPath: process.cwd(), configValidator }));
  const rejectedHistory = new BetterSqlite3(historyPath, { readonly: true });
  try {
    assert.deepEqual(readApplicationRows(rejectedHistory), originalRows);
    assert.deepEqual(rejectedHistory.prepare("SELECT created_at FROM __drizzle_migrations WHERE hash = 'unknown-sql'").get(), { created_at: 1785685134232 });
  } finally {
    rejectedHistory.close();
  }

  console.log(
    "SQLite thread, message, Provider/model/character config, and legacy migration recovery passed.",
  );
} finally {
  runtime?.close();
  legacyRuntime?.close();
  jumpRuntime?.close();
  speechMigrationRuntime?.close();
  deletionRuntime?.close();
  rmSync(userDataPath, { recursive: true, force: true });
  rmSync(legacyUserDataPath, { recursive: true, force: true });
  rmSync(jumpUserDataPath, { recursive: true, force: true });
  rmSync(speechMigrationUserDataPath, { recursive: true, force: true });
  rmSync(deletionUserDataPath, { recursive: true, force: true });
}
