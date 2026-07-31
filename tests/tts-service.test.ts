import type { SpeechResult } from "ai";
import { MockSpeechModelV4 } from "ai/test";
import { describe, expect, it, vi } from "vitest";
import type {
  Character,
  ModelConfig,
  ProviderConfig,
} from "../src/shared/ipc";
import {
  createSpeechService,
} from "../src/main/speech/ttsService";
import type { TtsCache } from "../src/main/speech/ttsCache";

const characterId = "00000000-0000-4000-8000-000000000001";
const modelConfigId = "00000000-0000-4000-8000-000000000002";
const providerConfigId = "00000000-0000-4000-8000-000000000003";
const now = new Date("2026-07-30T00:00:00.000Z");
const validAudio = new Uint8Array(48);
validAudio.set([
  0x52, 0x49, 0x46, 0x46, 1, 0, 0, 0, 0x57, 0x41, 0x56, 0x45,
]);
const speechModel = new MockSpeechModelV4();

const isWav = (audio: Uint8Array): boolean =>
  audio.byteLength >= 44 &&
  audio[0] === 0x52 &&
  audio[1] === 0x49 &&
  audio[2] === 0x46 &&
  audio[3] === 0x46 &&
  audio[8] === 0x57 &&
  audio[9] === 0x41 &&
  audio[10] === 0x56 &&
  audio[11] === 0x45;

const character: Character = {
  id: characterId,
  name: "星澄",
  portraitAssetId: null,
  portraitFocusX: 0.5,
  portraitFocusY: 0,
  portraitZoom: 1,
  modelConfigId: null,
  speechModelConfigId: modelConfigId,
  speechVoice: "alloy",
  systemPrompt: "",
  createdAt: now,
  updatedAt: now,
};

const modelConfig: ModelConfig = {
  id: modelConfigId,
  providerConfigId,
  modelType: "speechModel",
  modelId: "gpt-4o-mini-tts",
  displayName: null,
  speechMetadata: {
    voices: [{ id: "alloy", displayName: "Alloy" }],
    defaultVoiceId: "alloy",
  },
  settings: null,
  enabled: true,
  createdAt: now,
  updatedAt: now,
};

const providerConfig: ProviderConfig = {
  id: providerConfigId,
  displayName: "OpenAI",
  providerType: "openai",
  baseUrl: null,
  credentialRef: "safe-storage/key",
  settings: null,
  enabled: true,
  createdAt: now,
  updatedAt: now,
};

function speechResult(
  audio = validAudio,
  format = "wav",
  mediaType = "audio/wav",
): SpeechResult {
  return {
    audio: {
      uint8Array: audio,
      base64: "",
      format,
      mediaType,
    },
    warnings: [],
    responses: [],
    providerMetadata: {},
  };
}

function resolvedSpeechModel() {
  return {
    model: speechModel,
    output: {
      requestFormat: "wav",
      format: "wav",
      mediaType: "audio/wav" as const,
    },
    normalizeAudio: (audio: SpeechResult["audio"]) => ({
      audio: new Uint8Array(audio.uint8Array),
      format: audio.format,
      mediaType: audio.mediaType as `audio/${string}`,
    }),
    validateAudio: isWav,
  };
}

function memoryCache(hit: Uint8Array | null = null): TtsCache & {
  get: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
} {
  return {
    initialize: async () => undefined,
    get: vi.fn(async () => hit),
    put: vi.fn(async () => undefined),
  };
}

function database(overrides: {
  readonly character?: Character;
  readonly model?: ModelConfig;
  readonly provider?: ProviderConfig;
} = {}) {
  return {
    fetchCharacter: vi.fn(() => overrides.character ?? character),
    fetchModelConfig: vi.fn(() => overrides.model ?? modelConfig),
    fetchProviderConfig: vi.fn(() => overrides.provider ?? providerConfig),
  };
}

describe("single-shot TTS service", () => {
  it("trims only the text edges, passes through Adapter-selected WAV, and stores it", async () => {
    const cache = memoryCache();
    const generate = vi.fn(async () => speechResult());
    const resolveSpeechModel = vi.fn(resolvedSpeechModel);
    const service = createSpeechService({
      database: database(),
      aiRuntime: { resolveSpeechModel },
      cache,
      generate,
    });

    const result = await service.generate(
      characterId,
      "  保留  内部空白  ",
      new AbortController().signal,
    );

    expect(result).toEqual({
      audio: validAudio,
      format: "wav",
      mediaType: "audio/wav",
      cacheHit: false,
    });
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: speechModel,
        text: "保留  内部空白",
        voice: "alloy",
        outputFormat: "wav",
      }),
    );
    expect(cache.put).toHaveBeenCalledWith(
      expect.any(String),
      "wav",
      validAudio,
      isWav,
      expect.any(AbortSignal),
    );
  });

  it("returns a cache hit without resolving or calling the Provider", async () => {
    const cache = memoryCache(validAudio);
    const generate = vi.fn(async () => speechResult());
    const resolveSpeechModel = vi.fn(resolvedSpeechModel);
    const service = createSpeechService({
      database: database(),
      aiRuntime: { resolveSpeechModel },
      cache,
      generate,
    });

    await expect(
      service.generate(characterId, "命中", new AbortController().signal),
    ).resolves.toEqual({
      audio: validAudio,
      format: "wav",
      mediaType: "audio/wav",
      cacheHit: true,
    });
    expect(resolveSpeechModel).toHaveBeenCalledOnce();
    expect(generate).not.toHaveBeenCalled();
  });

  it("preserves a soft reference but rejects an unavailable speech model", async () => {
    const service = createSpeechService({
      database: database({
        model: { ...modelConfig, enabled: false },
      }),
      aiRuntime: { resolveSpeechModel: resolvedSpeechModel },
      cache: memoryCache(),
    });

    await expect(
      service.generate(characterId, "文字", new AbortController().signal),
    ).rejects.toMatchObject({
      code: "model-unavailable",
    });
  });

  it("passes a manual Voice ID through even when it is absent from the catalog", async () => {
    const generate = vi.fn(async () => speechResult());
    const service = createSpeechService({
      database: database({
        character: { ...character, speechVoice: "removed-voice" },
      }),
      aiRuntime: { resolveSpeechModel: resolvedSpeechModel },
      cache: memoryCache(),
      generate,
    });

    await expect(
      service.generate(characterId, "文字", new AbortController().signal),
    ).resolves.toMatchObject({ cacheHit: false });
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({ voice: "removed-voice" }),
    );
  });

  it("rejects invalid audio and never caches it", async () => {
    const cache = memoryCache();
    const service = createSpeechService({
      database: database(),
      aiRuntime: { resolveSpeechModel: resolvedSpeechModel },
      cache,
      generate: async () =>
        speechResult(new Uint8Array([1, 2, 3]), "wav", "audio/wav"),
    });

    await expect(
      service.generate(characterId, "文字", new AbortController().signal),
    ).rejects.toMatchObject({
      code: "invalid-audio",
    });
    expect(cache.put).not.toHaveBeenCalled();
  });

  it("passes cancellation to the Provider and does not write a cache entry", async () => {
    const cache = memoryCache();
    const controller = new AbortController();
    const service = createSpeechService({
      database: database(),
      aiRuntime: { resolveSpeechModel: resolvedSpeechModel },
      cache,
      generate: ({ abortSignal }) =>
        new Promise<SpeechResult>((_resolve, reject) => {
          abortSignal?.addEventListener(
            "abort",
            () => reject(abortSignal.reason),
            { once: true },
          );
        }),
    });

    const pending = service.generate(characterId, "文字", controller.signal);
    controller.abort(new DOMException("Cancelled", "AbortError"));

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(cache.put).not.toHaveBeenCalled();
  });
});
