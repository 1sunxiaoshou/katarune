import { emptyAppSettings } from "./defaultSettings";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { app, safeStorage } from "electron";

import { createAiRuntime, type AiRuntimeDatabase } from "../src/main/ai/runtime";
import { createCredentialStore } from "../src/main/security/credentialStore";
import { createSpeechService } from "../src/main/speech/ttsService";
import { createTtsCache } from "../src/main/speech/ttsCache";
import type { Character, ModelConfig, ProviderConfig } from "../src/shared/ipc";

const apiKey = process.env.KATARUNE_TEST_FISH_AUDIO_API_KEY;
const voiceId = process.env.KATARUNE_TEST_FISH_AUDIO_VOICE_ID;
if (apiKey === undefined || apiKey.length === 0) {
  throw new Error("KATARUNE_TEST_FISH_AUDIO_API_KEY is not configured.");
}
if (voiceId === undefined || voiceId.length === 0) {
  throw new Error("KATARUNE_TEST_FISH_AUDIO_VOICE_ID is not configured.");
}

const providerConfigId = "01e6979a-c05f-484b-9c42-3402be2e0d55";
const modelConfigId = "9c38b838-2d3f-444d-b88e-0690e96a2d34";
const characterId = "00000000-0000-4000-8000-000000000001";
const now = new Date();
const userDataPath = mkdtempSync(join(tmpdir(), "katarune-fish-audio-tts-live-"));
let credentialReference: string | undefined;
let exitCode = 0;

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
      displayName: "Fish Audio TTS live test",
      providerType: "fish-audio",
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
      modelId: "s2.1-pro-free",
      displayName: "Fish Audio S2.1 Pro Free",
      metadata: {
        voices: null,
      },
      settings: { defaultVoiceId: voiceId },
      enabled: true,
      createdAt: now,
      updatedAt: now,
    };
    const character: Character = {
      id: characterId,
      name: "Fish Audio TTS live test",
      portraitAssetId: null,
      portraitFocusX: 0.5,
      portraitFocusY: 0,
      portraitZoom: 1,
  useDefaultSpeechModel: false, useDefaultSpeechVoice: false,
      modelConfigId: null,
      speechModelConfigId: modelConfigId,
      speechVoice: voiceId,
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
    const cache = createTtsCache({ directory: join(userDataPath, "tts-cache") });
    await cache.initialize();
    const service = createSpeechService({
      database: {
        getAppSettings: () => emptyAppSettings,
    fetchCharacter: () => character,
        fetchProviderConfig: () => providerConfig,
        fetchModelConfig: () => modelConfig,
      },
      aiRuntime: runtime,
      cache,
    });

    const text = "你好。";
    const first = await service.generate(
      characterId,
      text,
      AbortSignal.timeout(60_000),
    );
    assert.equal(first.cacheHit, false);
    assert.equal(first.format, "wav");
    assert.equal(first.mediaType, "audio/wav");
    assert.equal(String.fromCharCode(...first.audio.slice(0, 4)), "RIFF");
    assert.equal(String.fromCharCode(...first.audio.slice(8, 12)), "WAVE");
    const second = await service.generate(
      characterId,
      text,
      AbortSignal.timeout(60_000),
    );
    assert.equal(second.cacheHit, true);
    assert.deepEqual(second.audio, first.audio);
    console.log(
      `Fish Audio returned and cached a valid ${first.audio.byteLength}-byte WAV.`,
    );

    await credentialStore.delete(credentialReference);
    credentialReference = undefined;
  })
  .catch((error: unknown) => {
    console.error(
      error instanceof Error ? error.message : "Fish Audio TTS live test failed.",
    );
    exitCode = 1;
  })
  .finally(() => {
    rmSync(userDataPath, { recursive: true, force: true });
    app.exit(exitCode);
  });
