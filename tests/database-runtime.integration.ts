import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import BetterSqlite3 from "better-sqlite3";
import { openDatabase, type DatabaseRuntime } from "../src/main/database/database";

const threadId = "restart-recovery-thread";
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
let runtime: DatabaseRuntime | undefined;
let legacyRuntime: DatabaseRuntime | undefined;

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

try {
  runtime = openDatabase({ userDataPath, appPath: process.cwd() });
  runtime.initializeThread(threadId);
  runtime.appendThreadMessage({ threadId, message });
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
  const defaultCharacter = runtime.listCharacters().characters[0];
  assert.ok(defaultCharacter);
  assert.equal(defaultCharacter.name, "星澜");
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

  runtime = openDatabase({ userDataPath, appPath: process.cwd() });
  assert.equal(runtime.fetchThread(threadId).remoteId, threadId);
  assert.deepEqual(runtime.loadThreadMessages(threadId).messages, [message]);
  assert.deepEqual(runtime.fetchProviderConfig(providerConfig.id), providerConfig);
  assert.deepEqual(runtime.listProviderConfigs().providerConfigs, [providerConfig]);
  assert.deepEqual(runtime.fetchModelConfig(modelConfig.id), modelConfig);
  assert.deepEqual(runtime.listModelConfigs().modelConfigs, [modelConfig]);
  assert.deepEqual(runtime.fetchCharacter(updatedCharacter.id), updatedCharacter);
  assert.equal(runtime.listCharacters().characters[0]?.name, "数据库中的星澜");

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

  runtime.deleteThread(threadId);
  assert.deepEqual(runtime.loadThreadMessages(threadId).messages, []);
  runtime.deleteProviderConfig(providerConfig.id);
  assert.deepEqual(runtime.listProviderConfigs().providerConfigs, []);
  assert.deepEqual(runtime.listModelConfigs().modelConfigs, []);
  assert.equal(
    runtime.fetchCharacter(updatedCharacter.id).modelConfigId,
    modelConfig.id,
    "角色应保留已失效的模型引用，供 UI 显示不可用状态",
  );

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

  console.log(
    "SQLite thread, message, Provider/model/character config, and legacy migration recovery passed.",
  );
} finally {
  runtime?.close();
  legacyRuntime?.close();
  rmSync(userDataPath, { recursive: true, force: true });
  rmSync(legacyUserDataPath, { recursive: true, force: true });
}
