import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  modelId: "local-chat",
  displayName: "本地聊天模型",
  settings: { temperature: 0.7, maxOutputTokens: 512 },
  enabled: true,
} as const;

const userDataPath = mkdtempSync(join(tmpdir(), "katarune-database-test-"));
let runtime: DatabaseRuntime | undefined;

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
  runtime.close();
  runtime = undefined;

  runtime = openDatabase({ userDataPath, appPath: process.cwd() });
  assert.equal(runtime.fetchThread(threadId).remoteId, threadId);
  assert.deepEqual(runtime.loadThreadMessages(threadId).messages, [message]);
  assert.deepEqual(runtime.fetchProviderConfig(providerConfig.id), providerConfig);
  assert.deepEqual(runtime.listProviderConfigs().providerConfigs, [providerConfig]);
  assert.deepEqual(runtime.fetchModelConfig(modelConfig.id), modelConfig);
  assert.deepEqual(runtime.listModelConfigs().modelConfigs, [modelConfig]);

  const credentialReference = "safe-storage/12345678-1234-4123-8123-123456789abc";
  const providerWithCredential = runtime.setProviderCredentialReference(
    providerConfig.id,
    credentialReference,
  );
  assert.equal(providerWithCredential.credentialRef, credentialReference);

  const updatedModelConfig = runtime.updateModelConfig({
    id: modelConfig.id,
    modelId: "local-chat-updated",
    displayName: null,
    settings: { temperature: 0.2 },
    enabled: false,
  });
  assert.equal(updatedModelConfig.providerConfigId, providerConfig.id);
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
  console.log("SQLite thread, message, Provider config, and model config recovery passed.");
} finally {
  runtime?.close();
  rmSync(userDataPath, { recursive: true, force: true });
}
