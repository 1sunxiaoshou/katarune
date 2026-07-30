import { generateSpeech, type SpeechResult } from "ai";
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
  "fetchCharacter" | "fetchModelConfig" | "fetchProviderConfig"
>;

type SpeechGenerator = (
  options: Parameters<typeof generateSpeech>[0],
) => Promise<SpeechResult>;

export interface SpeechServiceResult {
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
  ): Promise<SpeechServiceResult>;
}

export function createSpeechService({
  database,
  aiRuntime,
  cache,
  generate = generateSpeech,
}: {
  readonly database: SpeechDatabase;
  readonly aiRuntime: Pick<AiRuntime, "resolveSpeechModel">;
  readonly cache: TtsCache;
  readonly generate?: SpeechGenerator;
}): SpeechService {
  return {
    generate: async (characterId, inputText, abortSignal) => {
      const text = inputText.trim();
      if (text.length === 0) {
        throw new SpeechServiceError("not-configured", "没有可朗读的文字。");
      }

      let character;
      try {
        character = database.fetchCharacter(characterId);
      } catch {
        throw new SpeechServiceError("model-unavailable", "角色不存在或已不可用。");
      }
      if (
        character.speechModelConfigId === null ||
        character.speechVoice === null
      ) {
        throw new SpeechServiceError("not-configured", "该角色尚未配置语音模型。");
      }

      let modelConfig;
      let providerConfig;
      try {
        modelConfig = database.fetchModelConfig(character.speechModelConfigId);
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
        voice: character.speechVoice,
        outputFormat: output.format,
      });
      const cached = await cache
        .get(cacheKey, output.format, resolved.validateAudio)
        .catch(() => null);
      if (cached !== null) {
        return {
          audio: cached,
          format: output.format,
          mediaType: output.mediaType,
          cacheHit: true,
        };
      }
      if (abortSignal.aborted) throw abortSignal.reason;

      const result = await generate({
        model: resolved.model,
        text,
        voice: character.speechVoice,
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
      };
    },
  };
}
