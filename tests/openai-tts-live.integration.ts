import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { app, safeStorage } from "electron";
import { createAiRuntime, type AiRuntimeDatabase } from "../src/main/ai/runtime";
import { createCredentialStore } from "../src/main/security/credentialStore";
import { createSpeechService } from "../src/main/speech/ttsService";
import { createTtsCache } from "../src/main/speech/ttsCache";
import type {
  Character,
  ModelConfig,
  ProviderConfig,
} from "../src/shared/ipc";

const apiKey = process.env.KATARUNE_TEST_OPENAI_API_KEY;
if (apiKey === undefined || apiKey.length === 0) {
  throw new Error("KATARUNE_TEST_OPENAI_API_KEY is not configured.");
}

const providerConfigId = "d3867f4b-e85f-4ff4-ac2b-974dc39ad832";
const modelConfigId = "e76076e7-73a8-42c2-92d7-f9fa8d44f5eb";
const characterId = "00000000-0000-4000-8000-000000000001";
const now = new Date();
const userDataPath = mkdtempSync(join(tmpdir(), "katarune-openai-tts-live-"));
let credentialReference: string | undefined;

void app
  .whenReady()
  .then(async () => {
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
      displayName: "OpenAI TTS live test",
      providerType: "openai",
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
      modelType: "speechModel",
      modelId: "gpt-4o-mini-tts",
      displayName: "OpenAI TTS live test",
      settings: null,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    };
    const character: Character = {
      id: characterId,
      name: "TTS live test",
      portraitAssetId: null,
      modelConfigId: null,
      speechModelConfigId: modelConfigId,
      speechVoice: "alloy",
      systemPrompt: "",
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
    const cache = createTtsCache({
      directory: join(userDataPath, "tts-cache"),
    });
    await cache.initialize();
    const service = createSpeechService({
      database: {
        fetchCharacter: () => character,
        fetchProviderConfig: () => providerConfig,
        fetchModelConfig: () => modelConfig,
      },
      aiRuntime: runtime,
      cache,
    });

    const first = await service.generate(
      characterId,
      "Katarune text to speech validation.",
      AbortSignal.timeout(15_000),
    );
    assert.equal(first.cacheHit, false);
    assert.equal(first.format, "wav");
    assert.equal(first.mediaType, "audio/wav");
    assert.equal(
      String.fromCharCode(...first.audio.slice(0, 4)),
      "RIFF",
    );
    assert.equal(
      String.fromCharCode(...first.audio.slice(8, 12)),
      "WAVE",
    );
    const second = await service.generate(
      characterId,
      "Katarune text to speech validation.",
      AbortSignal.timeout(15_000),
    );
    assert.equal(second.cacheHit, true);
    assert.deepEqual(second.audio, first.audio);
    console.log(
      `OpenAI TTS runtime returned and cached a valid ${first.audio.byteLength}-byte WAV.`,
    );

    await credentialStore.delete(credentialReference);
    credentialReference = undefined;
  })
  .catch((error: unknown) => {
    console.error(
      error instanceof Error ? error.message : "OpenAI TTS live test failed.",
    );
    process.exitCode = 1;
  })
  .finally(() => {
    rmSync(userDataPath, { recursive: true, force: true });
    app.quit();
  });
