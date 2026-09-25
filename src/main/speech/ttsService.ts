import { generateSpeech, type SpeechResult } from "ai";
import { createHash } from "node:crypto";
import type { SpeechSegment } from "../../shared/speechTiming";
import type { createSpeechArtifactCache } from "./speechArtifactCache";
import { resolveSpeechProfile } from "./speechProfiles";
import { resolveCharacterSpeechModel, resolveCharacterSpeechVoice } from "../../shared/speechSelection";
import { extractSpokenText } from "./spokenText";
import { alignOriginalSubtitles } from "./subtitleAlignment";
import { pcmWav, type SpeechStreamEvent } from "../ai/streamingSpeech";
import type { TimestampedSpeechAudio } from "../ai/timestampedSpeech";
import type { SpeechGenerateResponse } from "../../shared/ipc";
import type { AiRuntime } from "../ai/runtime";
import type { DatabaseRuntime } from "../database/database";
import {
  createSpeechCacheKey,
  isSafeAudioFormat,
  type TtsCache,
} from "./ttsCache";

export type SpeechErrorCode = Extract<
  SpeechGenerateResponse,
  { status: "error" }
>["code"];

export class SpeechServiceError extends Error {
  public constructor(
    public readonly code: SpeechErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SpeechServiceError";
  }
}

type SpeechDatabase = Pick<
  DatabaseRuntime,
  "fetchCharacter" | "fetchModelConfig" | "fetchProviderConfig" | "getAppSettings"
>;

type SpeechGenerator = (
  options: Parameters<typeof generateSpeech>[0],
) => Promise<SpeechResult>;

export interface SpeechServiceResult {
  readonly contentHash?: string;
  readonly timingSource?: "provider-segments" | "none";
  readonly spokenText?: string;
  readonly voiceKey?: string;
  readonly profilePath?: string | undefined;
  readonly segments?: SpeechSegment[];
  readonly audio: Uint8Array;
  readonly format: string;
  readonly mediaType: `audio/${string}`;
  readonly cacheHit: boolean;
}

export interface SpeechService {
  generate(
    characterId: string,
    text: string,
    abortSignal: AbortSignal,
    withTimestamps?: boolean,
    onStream?: SpeechStreamConsumer,
  ): Promise<SpeechServiceResult>;
}

export type SpeechStreamConsumer = (event: SpeechStreamEvent, context: {
  text: string; profilePath: string | undefined;
}) => Promise<void>;

export function createSpeechService({
  database,
  aiRuntime,
  cache,
  generate = generateSpeech,
  artifactCache,
  profileDirectory,
}: {
  readonly database: SpeechDatabase;
  readonly aiRuntime: Pick<AiRuntime, "resolveSpeechModel">;
  readonly cache: TtsCache;
  readonly generate?: SpeechGenerator;
  readonly artifactCache?: ReturnType<typeof createSpeechArtifactCache>;
  readonly profileDirectory?: string;
}): SpeechService {
  return {
    generate: async (characterId, inputText, abortSignal, withTimestamps = false, onStream) => {
      const text = withTimestamps ? extractSpokenText(inputText) : inputText.trim();
      if (text.length === 0) {
        throw new SpeechServiceError("not-configured", "没有可朗读的文字。");
      }

      let character;
      try {
        character = database.fetchCharacter(characterId);
      } catch {
        throw new SpeechServiceError("model-unavailable", "角色不存在或已不可用。");
      }
      const settings = database.getAppSettings();
      const speechModelConfigId = resolveCharacterSpeechModel(character, settings);
      if (
        speechModelConfigId === null
      ) {
        throw new SpeechServiceError("not-configured", character.useDefaultSpeechModel
          ? "请配置默认语音合成模型，并为角色确认该模型的音色。"
          : "该角色尚未配置语音模型。");
      }

      let modelConfig;
      let providerConfig;
      try {
        modelConfig = database.fetchModelConfig(speechModelConfigId);
        providerConfig = database.fetchProviderConfig(modelConfig.providerConfigId);
      } catch {
        throw new SpeechServiceError(
          "model-unavailable",
          "该角色原先配置的语音模型已不可用。",
        );
      }
      if (
        !modelConfig.enabled ||
        modelConfig.modelType !== "speechModel" ||
        !providerConfig.enabled
      ) {
        throw new SpeechServiceError(
          "model-unavailable",
          "该角色原先配置的语音模型已不可用。",
        );
      }
      let resolved;
      const speechVoice = resolveCharacterSpeechVoice(character, settings, modelConfig);
      if (speechVoice === null) {
        throw new SpeechServiceError("not-configured", "请设置默认音色，或为角色重新选择当前语音模型的音色。");
      }
      try {
        resolved = aiRuntime.resolveSpeechModel(modelConfig.id);
      } catch {
        throw new SpeechServiceError(
          "model-unavailable",
          "该角色原先配置的语音模型已不可用。",
        );
      }
      const { output } = resolved;
      if (
        !isSafeAudioFormat(output.format) ||
        !/^audio\/[a-z0-9][a-z0-9.+-]{0,63}$/.test(output.mediaType)
      ) {
        throw new SpeechServiceError(
          "model-unavailable",
          "语音模型 Adapter 声明了不安全的输出格式。",
        );
      }
      const cacheKey = createSpeechCacheKey({
        text,
        providerType: providerConfig.providerType,
        baseUrl: providerConfig.baseUrl,
        modelId: modelConfig.modelId,
        voice: speechVoice,
        outputFormat: output.format,
      });
      const voiceKey = createHash("sha256").update(JSON.stringify([
        providerConfig.id, modelConfig.modelId, speechVoice,
      ])).digest("hex");
      const profilePath = await resolveSpeechProfile(profileDirectory, voiceKey);
      if (withTimestamps && (resolved.generateWithTimestamps || (onStream && resolved.streamSpeech))) {
        const artifactKey = createHash("sha256").update(JSON.stringify({ mode: "timestamped-v1", cacheKey, providerId: providerConfig.id })).digest("hex");
        const metadata = (audio: Uint8Array, segments?: SpeechSegment[]) => ({
          contentHash: createHash("sha256").update(audio).digest("hex"),
          timingSource: segments?.length ? "provider-segments" as const : "none" as const,
        });
        const present = (artifact: TimestampedSpeechAudio, cacheHit: boolean) => {
          const { segments: providerSegments, ...audio } = artifact;
          const segments = alignOriginalSubtitles(text, providerSegments);
          return { ...audio, ...(segments ? { segments } : {}), ...metadata(audio.audio, segments),
            spokenText: text, voiceKey, profilePath, cacheHit };
        };
        const cachedArtifact = await artifactCache?.get(artifactKey).catch(() => null);
        abortSignal.throwIfAborted();
        if (cachedArtifact && resolved.validateAudio(cachedArtifact.audio))
          return present(cachedArtifact, true);
        const options = { text, voice: speechVoice, outputFormat: "wav", abortSignal };
        let artifact: TimestampedSpeechAudio;
        let streaming = false;
        if (onStream && resolved.streamSpeech) {
          const chunks: Uint8Array[] = [];
          let bytes = 0, sampleRate = 0, ended = false;
          let segments: SpeechSegment[] | undefined;
          for await (const event of resolved.streamSpeech(options)) {
            abortSignal.throwIfAborted();
            if (ended) throw new Error("Speech data after end.");
            if (event.type === "format") {
              if (sampleRate || event.encoding !== "pcm-s16le" || event.channels !== 1
                || !Number.isInteger(event.sampleRate) || event.sampleRate < 8000 || event.sampleRate > 48000)
                throw new Error("Unsupported streaming audio format.");
              sampleRate = event.sampleRate;
              streaming = true;
            } else if (!sampleRate) throw new Error("Missing streaming audio format.");
            if (event.type === "audio") {
              if (event.audio.length % 2) throw new Error("Incomplete PCM sample.");
              bytes += event.audio.length;
              if (bytes > 128 * 1024 * 1024) throw new Error("Speech audio exceeds limit.");
              chunks.push(event.audio);
            }
            if (event.type === "alignment") segments = event.segments.length ? event.segments : undefined;
            if (event.type === "end") { ended = true; continue; }
            await onStream(event.type === "alignment"
              ? { type: "alignment", segments: alignOriginalSubtitles(text, segments, true) ?? [] } : event,
              { text, profilePath });
          }
          if (!ended || !sampleRate) throw new Error("Incomplete speech stream.");
          if (segments?.some(segment => segment.endSeconds > bytes / (sampleRate * 2) + .05)) {
            segments = undefined;
            await onStream({ type: "alignment", segments: [] }, { text, profilePath });
          }
          artifact = { audio: pcmWav(Buffer.concat(chunks), sampleRate), format: "wav", mediaType: "audio/wav",
            ...(segments ? { segments } : {}) };
        } else artifact = await resolved.generateWithTimestamps!(options);
        if (artifact.format !== "wav" || !resolved.validateAudio(artifact.audio))
          throw new SpeechServiceError("invalid-audio", "供应商返回了损坏的语音。");
        abortSignal.throwIfAborted();
        await artifactCache?.put(artifactKey, artifact, abortSignal).catch(() => {});
        abortSignal.throwIfAborted();
        if (streaming && onStream) await onStream({ type: "end" }, { text, profilePath });
        return present(artifact, false);
      }
      const cached = await cache
        .get(cacheKey, output.format, resolved.validateAudio)
        .catch(() => null);
      if (cached !== null) {
        return {
          audio: cached,
          format: output.format,
          mediaType: output.mediaType,
          cacheHit: true,
          ...(withTimestamps ? { spokenText: text, voiceKey, profilePath, timingSource: "none" as const,
            contentHash: createHash("sha256").update(cached).digest("hex") } : {}),
        };
      }
      if (abortSignal.aborted) throw abortSignal.reason;

      const result = await generate({
        model: resolved.model,
        text,
        voice: speechVoice,
        outputFormat: output.requestFormat,
        abortSignal,
      });
      let normalized;
      try {
        normalized = resolved.normalizeAudio(result.audio);
      } catch {
        throw new SpeechServiceError(
          "invalid-audio",
          "供应商返回了无法处理的音频。",
        );
      }
      const audio = normalized.audio;
      if (
        normalized.format !== output.format ||
        normalized.mediaType !== output.mediaType ||
        !resolved.validateAudio(audio)
      ) {
        throw new SpeechServiceError(
          "invalid-audio",
          "供应商返回的音频与 Adapter 声明不一致或已损坏。",
        );
      }
      if (abortSignal.aborted) throw abortSignal.reason;

      await cache
        .put(
          cacheKey,
          output.format,
          audio,
          resolved.validateAudio,
          abortSignal,
        )
        .catch(() => undefined);
      if (abortSignal.aborted) throw abortSignal.reason;
      return {
        audio,
        format: output.format,
        mediaType: output.mediaType,
        cacheHit: false,
        ...(withTimestamps ? { spokenText: text, voiceKey, profilePath, timingSource: "none" as const,
          contentHash: createHash("sha256").update(audio).digest("hex") } : {}),
      };
    },
  };
}
