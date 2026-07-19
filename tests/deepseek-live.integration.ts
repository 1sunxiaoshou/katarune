import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { app, safeStorage } from "electron";
import { createAiRuntime, type AiRuntimeDatabase } from "../src/main/ai/runtime";
import { createCredentialStore } from "../src/main/security/credentialStore";
import type { ModelConfig, ProviderConfig } from "../src/shared/ipc";

const apiKey = process.env.KATARUNE_TEST_DEEPSEEK_API_KEY;
if (apiKey === undefined || apiKey.length === 0) {
  throw new Error("KATARUNE_TEST_DEEPSEEK_API_KEY is not configured.");
}

const providerConfigId = "d3867f4b-e85f-4ff4-ac2b-974dc39ad832";
const modelConfigId = "e76076e7-73a8-42c2-92d7-f9fa8d44f5eb";
const now = new Date();
const userDataPath = mkdtempSync(join(tmpdir(), "katarune-deepseek-live-test-"));
let credentialReference: string | undefined;

void app.whenReady().then(async () => {
  const credentialStore = await createCredentialStore({
    userDataPath,
    cipher: {
      isEncryptionAvailable: () => safeStorage.isAsyncEncryptionAvailable(),
      encryptString: (value) => safeStorage.encryptStringAsync(value),
      decryptString: (value) => safeStorage.decryptStringAsync(value),
    },
  });
  credentialReference = await credentialStore.put(apiKey);

  const providerConfig: ProviderConfig = {
    id: providerConfigId,
    registryId: "deepseek-live",
    displayName: "DeepSeek live test",
    providerType: "deepseek",
    baseUrl: null,
    credentialRef: credentialReference,
    settings: null,
    enabled: true,
    createdAt: now,
    updatedAt: now,
  };
  const modelConfig: ModelConfig = {
    id: modelConfigId,
    providerConfigId,
    modelId: "deepseek-chat",
    displayName: "DeepSeek Chat live test",
    settings: { maxOutputTokens: 16 },
    enabled: true,
    createdAt: now,
    updatedAt: now,
  };
  const database: AiRuntimeDatabase = {
    listProviderConfigs: () => ({ providerConfigs: [providerConfig] }),
    listModelConfigs: () => ({ modelConfigs: [modelConfig] }),
    fetchProviderConfig: () => providerConfig,
    fetchModelConfig: () => modelConfig,
  };

  const runtime = await createAiRuntime({ database, credentialStore });
  assert.deepEqual(runtime.getStatus(), {
    ready: true,
    configuredProviderCount: 1,
    modelCallsEnabled: true,
  });
  const result = await runtime.testConnection(modelConfigId);
  assert.equal(result.success, true, result.message);
  console.log(`Encrypted DeepSeek Provider runtime test passed in ${result.latencyMs} ms.`);

  await credentialStore.delete(credentialReference);
  credentialReference = undefined;
}).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "DeepSeek live test failed.");
  process.exitCode = 1;
}).finally(() => {
  rmSync(userDataPath, { recursive: true, force: true });
  app.quit();
});
