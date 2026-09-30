import { emptyAppSettings } from "./defaultSettings";
import type { SpeechResult } from "ai";
import { MockSpeechModelV4 } from "ai/test";
import type { SpeechStreamEvent } from "../src/main/ai/streamingSpeech";
import { describe, expect, it, vi } from "vitest";
import type {
  AppSettings,
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
  useDefaultSpeechModel: false, useDefaultSpeechVoice: false,
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
  metadata: {
    voices: [{ id: "alloy", displayName: "Alloy" }],
  },
  settings: { defaultVoiceId: "alloy" },
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
  readonly settings?: AppSettings;
  readonly character?: Character;
  readonly model?: ModelConfig;
  readonly provider?: ProviderConfig;
} = {}) {
  return {
    getAppSettings: () => overrides.settings ?? emptyAppSettings,
    fetchCharacter: vi.fn(() => overrides.character ?? character),
    fetchModelConfig: vi.fn(() => overrides.model ?? modelConfig),
    fetchProviderConfig: vi.fn(() => overrides.provider ?? providerConfig),
  };
}

describe("single-shot TTS service", () => {
  it("follows global speech model and voice changes at invocation time", async () => {
    const settings: AppSettings = { ...emptyAppSettings, defaultSpeechModelConfigId: modelConfig.id, defaultSpeechVoice: "alloy" };
    const db = database({ character: { ...character, speechModelConfigId: null, speechVoice: null,
      useDefaultSpeechModel: true, useDefaultSpeechVoice: true } });
    db.getAppSettings = () => settings;
    const generate = vi.fn(async (_options: Parameters<typeof import("ai").generateSpeech>[0]) => speechResult());
    const service = createSpeechService({ database: db, cache: memoryCache(), generate,
      aiRuntime: { resolveSpeechModel: vi.fn(resolvedSpeechModel) } });
    await service.generate(characterId, "你好", new AbortController().signal);
    expect(generate.mock.calls[0]?.[0]).toMatchObject({ voice: "alloy" });
    Object.assign(settings, { defaultSpeechVoice: "nova" });
    await service.generate(characterId, "你好", new AbortController().signal);
    expect(generate.mock.calls[1]?.[0]).toMatchObject({ voice: "nova" });
  });

  it("does not enable a previously silent character when global defaults are configured", async () => {
    const service = createSpeechService({ database: database({
      settings: { ...emptyAppSettings, defaultSpeechModelConfigId: modelConfig.id, defaultSpeechVoice: "alloy" },
      character: { ...character, speechModelConfigId: null, speechVoice: null },
    }), cache: memoryCache(), aiRuntime: { resolveSpeechModel: vi.fn(resolvedSpeechModel) } });
    await expect(service.generate(characterId, "你好", new AbortController().signal)).rejects.toMatchObject({ code: "not-configured" });
  });

  it("requires voice confirmation when an inherited model changes under an explicit voice", async () => {
    const service = createSpeechService({ database: database({
      settings: { ...emptyAppSettings, defaultSpeechModelConfigId: "00000000-0000-4000-8000-000000000099", defaultSpeechVoice: "nova" },
      model: { ...modelConfig, id: "00000000-0000-4000-8000-000000000099" },
      character: { ...character, useDefaultSpeechModel: true },
    }), cache: memoryCache(), aiRuntime: { resolveSpeechModel: vi.fn(resolvedSpeechModel) } });
    await expect(service.generate(characterId, "你好", new AbortController().signal)).rejects.toMatchObject({ code: "not-configured" });
  });

  it("streams before completion, applies sink backpressure, and reuses the complete WAV cache", async () => {
    const put = vi.fn();
    let cached: Awaited<ReturnType<NonNullable<Parameters<typeof createSpeechService>[0]["artifactCache"]>["get"]>> = null;
    let resume!: () => void;
    const gate = new Promise<void>(resolve => { resume = resolve; });
    let advanced = false;
    const streamSpeech = vi.fn(async function* (): AsyncIterable<SpeechStreamEvent> {
      yield { type: "format", sampleRate: 24000, channels: 1, encoding: "pcm-s16le" };
      yield { type: "alignment", segments: [{ text: "你好", startSeconds: 0, endSeconds: .1 }] };
      yield { type: "audio", audio: new Uint8Array(4800) };
      advanced = true;
      yield { type: "end" };
    });
    const service = createSpeechService({ database: database(), cache: memoryCache(),
      aiRuntime: { resolveSpeechModel: () => ({ ...resolvedSpeechModel(), streamSpeech, generateWithTimestamps: vi.fn() }) },
      artifactCache: { get: async () => cached, put: async (_key, artifact) => { put(artifact); cached = artifact; } },
    });
    const events: SpeechStreamEvent[] = [];
    const work = service.generate(characterId, "你好。下一句。", new AbortController().signal, true, async event => {
      events.push(event); if (event.type === "audio") await gate;
    });
    await vi.waitFor(() => expect(events.some(event => event.type === "audio")).toBe(true));
    expect(advanced).toBe(false); expect(put).not.toHaveBeenCalled();
    expect(events[1]).toEqual({ type: "alignment", segments: [{ text: "你好。", startSeconds: 0, endSeconds: .1 }] });
    resume();
    expect((await work).format).toBe("wav");
    expect(events.at(-1)?.type).toBe("end");
    const sink = vi.fn();
    expect((await service.generate(characterId, "你好。下一句。", new AbortController().signal, true, sink)).cacheHit).toBe(true);
    expect(streamSpeech).toHaveBeenCalledOnce(); expect(sink).not.toHaveBeenCalled();
  });
  it("maps cached provider alignment back to original subtitle text without synthesis", async () => {
    const generateWithTimestamps = vi.fn();
    const service = createSpeechService({ database: database(), cache: memoryCache(),
      aiRuntime: { resolveSpeechModel: () => ({ ...resolvedSpeechModel(), generateWithTimestamps }) },
      artifactCache: {
        get: async () => ({ audio: validAudio, format: "wav", mediaType: "audio/wav",
          segments: [{ text: "老师", startSeconds: 0, endSeconds: 1 }, { text: "你好", startSeconds: 1, endSeconds: 2 }] }),
        put: vi.fn(),
      },
    });
    const result = await service.generate(characterId, "**老师**，你好！", new AbortController().signal, true);
    expect(result.cacheHit).toBe(true);
    expect(result.segments?.map(segment => segment.text)).toEqual(["老师，", "你好！"]);
    expect(generateWithTimestamps).not.toHaveBeenCalled();
  });
  it("uses the independent timestamp capability without calling the ordinary generator", async () => {
    const generate = vi.fn(async () => speechResult());
    const generateWithTimestamps = vi.fn(async () => ({ audio: validAudio, format: "wav", mediaType: "audio/wav" as const,
      segments: [{ text: "十二", startSeconds: 0, endSeconds: .5 }] }));
    const service = createSpeechService({ database: database(), cache: memoryCache(), generate,
      aiRuntime: { resolveSpeechModel: () => ({ ...resolvedSpeechModel(), generateWithTimestamps }) } });
    const result = await service.generate(characterId, "**12**", new AbortController().signal, true);
    expect(generate).not.toHaveBeenCalled();
    expect(generateWithTimestamps).toHaveBeenCalledWith(expect.objectContaining({ text: "12", voice: "alloy" }));
    expect(result.spokenText).toBe("12");
    expect(result.segments).toBeUndefined();
    expect(result.timingSource).toBe("none");
  });
  it("does not retry ordinary synthesis after a timestamp request fails", async () => {
    const generate = vi.fn(async () => speechResult());
    const service = createSpeechService({ database: database(), cache: memoryCache(), generate,
      aiRuntime: { resolveSpeechModel: () => ({ ...resolvedSpeechModel(), generateWithTimestamps: async () => { throw new Error("failed"); } }) } });
    await expect(service.generate(characterId, "test", new AbortController().signal, true)).rejects.toThrow("failed");
    expect(generate).not.toHaveBeenCalled();
  });
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
