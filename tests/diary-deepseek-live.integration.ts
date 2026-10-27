// Explicitly invoked paid test. Only synthetic conversations leave this process.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { app, safeStorage } from "electron";
import { APICallError, wrapLanguageModel } from "ai";
import { createAiRuntime } from "../src/main/ai/runtime";
import { validateModelMetadata, validateModelSettings, validateProviderSettings } from "../src/main/ai/providerDefinitions";
import { openDatabase } from "../src/main/database/database";
import { createCredentialStore } from "../src/main/security/credentialStore";
import { createDiaryService } from "../src/main/memory/diaryService";
import { diaryFailureCode } from "../src/main/memory/diaryErrors";
import { memoryDay } from "../src/shared/memory";
import { modelConfigSchema, providerConfigSchema } from "../src/shared/ipc";

function configuredDeepSeek() {
  if (process.env.KATARUNE_TEST_DEEPSEEK_API_KEY) {
    const now = new Date();
    const provider = providerConfigSchema.parse({ id: "00000000-0000-4000-8000-000000000081", displayName: "DeepSeek diary live test", providerType: "deepseek", baseUrl: null, credentialRef: null, settings: null, enabled: true, createdAt: now, updatedAt: now });
    const model = modelConfigSchema.parse({ id: "00000000-0000-4000-8000-000000000082", providerConfigId: provider.id, modelType: "languageModel", modelId: process.env.KATARUNE_TEST_DEEPSEEK_MODEL ?? "deepseek-flash", displayName: "Diary live test", metadata: null, settings: null, enabled: true, createdAt: now, updatedAt: now });
    return { model, provider };
  }
  throw new Error("KATARUNE_TEST_DEEPSEEK_API_KEY is not configured.");
}

const temporary = mkdtempSync(join(tmpdir(), "katarune-diary-deepseek-live-"));
app.setPath("userData", temporary);
let database: ReturnType<typeof openDatabase> | undefined;
let service: ReturnType<typeof createDiaryService> | undefined;
let sdkWarnings = 0;
let schemaWarnings = 0;
let phase = "configuration";
const onWarning = (warning: Error) => {
  if (warning.message.includes("AI SDK Warning")) sdkWarnings++;
  if (warning.message.includes("responseFormat JSON schema")) schemaWarnings++;
};
process.on("warning", onWarning);

void app.whenReady().then(async () => {
  assert.notEqual(globalThis.AI_SDK_LOG_WARNINGS, false, "SDK warning logging must remain enabled");
  const source = configuredDeepSeek();
  phase = "credential-store";
  const credentialStore = await createCredentialStore({ userDataPath: temporary, cipher: {
    isEncryptionAvailable: () => safeStorage.isAsyncEncryptionAvailable(),
    encryptString: value => safeStorage.encryptStringAsync(value),
    decryptString: value => safeStorage.decryptStringAsync(value),
  } });
  const provider = { ...source.provider, credentialRef: await credentialStore.put(process.env.KATARUNE_TEST_DEEPSEEK_API_KEY!) };
  phase = "runtime";
  const runtime = await createAiRuntime({ credentialStore, database: {
    listProviderConfigs: () => ({ providerConfigs: [provider] }),
    listModelConfigs: () => ({ modelConfigs: [source.model] }),
    fetchProviderConfig: () => provider,
    fetchModelConfig: () => source.model,
  } });
  const observed: { requests: number; toolCalls: string[]; warnings: number; jsonRequests: number } = { requests: 0, toolCalls: [], warnings: 0, jsonRequests: 0 };
  phase = "model-resolution";
  const model = wrapLanguageModel({ model: runtime.resolveLanguageModel(source.model.id), middleware: {
    wrapGenerate: async ({ doGenerate, params }) => {
      observed.requests++;
      if (params.responseFormat?.type === "json") observed.jsonRequests++;
      const result = await doGenerate();
      observed.warnings += result.warnings.length;
      observed.toolCalls.push(...result.content.flatMap(part => part.type === "tool-call" ? [part.toolName] : []));
      return result;
    },
  } });
  phase = "isolated-database";
  database = openDatabase({ userDataPath: temporary, appPath: process.cwd(), configValidator: { validateModelMetadata, validateModelSettings, validateProviderSettings } });
  const characterId = database.getAppState().activeCharacter.id;
  database.updateCharacter({ id: characterId, name: "小灯", modelConfigId: null, systemPrompt: "你叫小灯，是安静、细心的数字伙伴。你称呼对方为阿澈。用简洁、自然的第一人称写给自己。" });
  const threadId = "diary-live-synthetic";
  database.initializeThread(threadId, characterId);
  const conversation = [
    { role: "user", text: "今天终于把第一首练习曲完整弹下来了。中间错了两次，但我没有像以前一样停下来重弹。" },
    { role: "assistant", text: "两次错音也没让你停下来呀。你弹完的那一刻是什么感觉？" },
    { role: "user", text: "比弹对所有音还高兴。我想先录下来，周末给小林听。这件事我也想和你记住。" },
    { role: "assistant", text: "那我记住今天这份高兴。等你周末分享以后，也告诉我小林的反应吧。" },
  ];
  conversation.forEach((message, index) => {
    const id = `diary-live-${index}`;
    database!.appendThreadMessage({ threadId, characterId, message: { id, parent_id: index ? `diary-live-${index - 1}` : null, format: "ai-sdk/v6", content: { role: message.role, parts: [{ type: "text", text: message.text }] } }, assetIds: [] });
    database!.queueMemoryDiaryMessage(characterId, id, "Asia/Shanghai");
  });
  database.saveMemory(characterId, { id: null, revision: null, content: { kind: "person", title: "小林", body: "阿澈的朋友，约好周末听阿澈录下的练习曲。", isUser: false } });
  const day = memoryDay(new Date(), "Asia/Shanghai");
  service = createDiaryService({ database: { ...database, getAppSettings: () => ({ ...database!.getAppSettings(), defaultLanguageModelConfigId: source.model.id }) }, aiRuntime: { resolveLanguageModel: () => model }, now: () => new Date(Date.now() + 2 * 86_400_000) });
  console.log(JSON.stringify({ stage: "live-request", model: source.model.modelId, syntheticMessages: conversation.length, warningLogging: "enabled" }));
  const start = Date.now();
  phase = "generation";
  assert.equal(await service.runOnce(), true);
  const state = database.getMemoryDiaryState(characterId);
  assert.equal(state.failed, 0, `Diary failed: ${state.lastFailure?.code ?? "unknown"}`);
  assert.equal(state.pending, 0);
  const entries = database.listMemory({ characterId, kind: "diary", query: "", offset: 0 }).entries;
  assert.equal(entries.length, 1, "The meaningful synthetic day must produce a persisted diary");
  const entry = database.readMemory(characterId, entries[0]!.id);
  assert.equal(entry.content.kind, "diary");
  assert.equal(entries[0]!.day, day);
  assert.ok(entry.content.title.trim().length > 0 && entry.content.body.trim().length > 0);
  assert.ok(observed.toolCalls.includes("finish_diary"));
  assert.equal(observed.jsonRequests, 0);
  const requests = observed.requests;
  assert.equal(await service.runOnce(), false);
  assert.equal(observed.requests, requests, "A completed day must not call the provider again");
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(schemaWarnings, 0);
  assert.equal(observed.warnings, 0);
  assert.equal(sdkWarnings, 0);
  console.log(JSON.stringify({ stage: "passed", model: source.model.modelId, latencyMs: Date.now() - start, modelRequests: requests, toolCalls: observed.toolCalls, savedDiaries: entries.length, titleCharacters: entry.content.title.length, bodyCharacters: entry.content.body.length, sdkWarnings, jsonSchemaWarnings: schemaWarnings, duplicateRequests: 0 }));
}).catch((error: unknown) => {
  // Do not print provider bodies, generated prose, credentials or original config.
  console.error(JSON.stringify({ stage: "failed", phase, category: diaryFailureCode(error), errorType: error instanceof Error ? error.name : "unknown", status: APICallError.isInstance(error) ? error.statusCode : undefined, assertion: error instanceof assert.AssertionError ? error.message : undefined }));
  process.exitCode = 1;
}).finally(() => {
  service?.dispose(); database?.close();
  process.off("warning", onWarning);
  rmSync(temporary, { recursive: true, force: true });
  app.exit(Number(process.exitCode ?? 0));
});
