import {
  NoSuchModelError,
  type ProviderV4,
  type SharedV4Warning,
  type SpeechModelV4,
} from "@ai-sdk/provider";
import {
  combineHeaders,
  createBinaryResponseHandler,
  createJsonErrorResponseHandler,
  loadApiKey,
  postJsonToApi,
  validateBaseURL,
  withoutTrailingSlash,
  type FetchFunction,
} from "@ai-sdk/provider-utils";
import * as z from "zod/mini";
import { readFishTimestampStream, streamFishTimestamps } from "./fishAudioTimestamps";
import type { StreamingSpeechModel, SpeechStreamEvent } from "./streamingSpeech";
import type { TimestampedSpeechModel } from "./timestampedSpeech";
import { wavDuration, normalizeFishStreamingWav } from "./wavDuration";

const fishAudioErrorSchema = z.object({
  status: z.optional(z.number()),
  message: z.string(),
});

const fishAudioFailedResponseHandler = createJsonErrorResponseHandler({
  errorSchema: fishAudioErrorSchema,
  errorToMessage: (error) => error.message,
});

export interface FishAudioProviderSettings {
  readonly apiKey?: string;
  readonly baseURL?: string;
  readonly fetch?: FetchFunction;
}

interface FishAudioSpeechModelConfig {
  readonly baseURL: string;
  readonly headers: () => Record<string, string | undefined>;
  readonly fetch?: FetchFunction;
  readonly currentDate?: () => Date;
}

class FishAudioSpeechModel implements SpeechModelV4, TimestampedSpeechModel, StreamingSpeechModel {
  readonly specificationVersion = "v4";
  readonly provider = "fish-audio.speech";

  constructor(
    readonly modelId: string,
    private readonly config: FishAudioSpeechModelConfig,
  ) {}

  async doGenerate(
    options: Parameters<SpeechModelV4["doGenerate"]>[0],
  ): Promise<Awaited<ReturnType<SpeechModelV4["doGenerate"]>>> {
    const warnings: SharedV4Warning[] = [];
    const supportedFormats = new Set(["wav", "pcm", "mp3", "opus"]);
    const outputFormat = supportedFormats.has(options.outputFormat ?? "wav")
      ? (options.outputFormat ?? "wav")
      : "wav";

    if (outputFormat !== options.outputFormat && options.outputFormat !== undefined) {
      warnings.push({
        type: "unsupported",
        feature: "outputFormat",
        details: `Unsupported output format: ${options.outputFormat}. Using wav instead.`,
      });
    }
    if (options.instructions !== undefined) {
      warnings.push({
        type: "unsupported",
        feature: "instructions",
        details:
          "Fish Audio controls delivery through text markers and does not accept a separate instructions field.",
      });
    }
    if (options.language !== undefined) {
      warnings.push({
        type: "unsupported",
        feature: "language",
        details: "Fish Audio detects the language from the input text.",
      });
    }

    const validSpeed =
      options.speed === undefined ||
      (Number.isFinite(options.speed) && options.speed >= 0.5 && options.speed <= 2);
    if (!validSpeed) {
      warnings.push({
        type: "unsupported",
        feature: "speed",
        details: "Fish Audio speech speed must be between 0.5 and 2.0.",
      });
    }

    const requestBody = {
      text: options.text,
      ...(options.voice === undefined ? {} : { reference_id: options.voice }),
      format: outputFormat,
      ...(options.speed === undefined || !validSpeed
        ? {}
        : { prosody: { speed: options.speed } }),
    };
    const timestamp = this.config.currentDate?.() ?? new Date();
    const {
      value: audio,
      responseHeaders,
      rawValue: rawResponse,
    } = await postJsonToApi({
      url: `${this.config.baseURL}/v1/tts`,
      headers: combineHeaders(
        this.config.headers(),
        { model: this.modelId },
        options.headers,
      ),
      body: requestBody,
      failedResponseHandler: fishAudioFailedResponseHandler,
      successfulResponseHandler: createBinaryResponseHandler(),
      ...(options.abortSignal === undefined
        ? {}
        : { abortSignal: options.abortSignal }),
      ...(this.config.fetch === undefined ? {} : { fetch: this.config.fetch }),
    });

    return {
      audio,
      warnings,
      request: { body: JSON.stringify(requestBody) },
      response: {
        timestamp,
        modelId: this.modelId,
        ...(responseHeaders === undefined ? {} : { headers: responseHeaders }),
        body: rawResponse,
      },
    };
  }

  async *streamSpeech(options: Parameters<SpeechModelV4["doGenerate"]>[0]): AsyncIterable<SpeechStreamEvent> {
    const sampleRate = 24000;
    yield { type: "format", sampleRate, channels: 1, encoding: "pcm-s16le" };
    const response = await this.timestampResponse(options, { format: "pcm", sample_rate: sampleRate, latency: "balanced" });
    let tail = new Uint8Array();
    for await (const event of streamFishTimestamps(response)) {
      if (event.type !== "audio") { yield event; continue; }
      const bytes = Buffer.concat([tail, event.audio]);
      const aligned = bytes.length - bytes.length % 2;
      tail = bytes.subarray(aligned);
      if (aligned) yield { type: "audio", audio: new Uint8Array(bytes.subarray(0, aligned)) };
    }
    if (tail.length) throw new Error("Incomplete PCM sample.");
    yield { type: "end" };
  }

  private async timestampResponse(options: Parameters<SpeechModelV4["doGenerate"]>[0], output: object) {
    const response = await (this.config.fetch ?? fetch)(`${this.config.baseURL}/v1/tts/stream/with-timestamp`, {
      method: "POST",
      headers: Object.fromEntries(Object.entries(combineHeaders(this.config.headers(), { "Content-Type": "application/json", model: this.modelId }, options.headers)).filter((entry): entry is [string, string] => entry[1] !== undefined)),
      body: JSON.stringify({ text: options.text, reference_id: options.voice, ...output }),
      ...(options.abortSignal ? { signal: options.abortSignal } : {}),
    });
    if (!response.ok || !response.body) throw new Error(`Fish timestamp synthesis failed (${response.status}).`);
    return response.body;
  }

  async generateWithTimestamps(options: Parameters<SpeechModelV4["doGenerate"]>[0]) {
    const result = await readFishTimestampStream(await this.timestampResponse(options, { format: "wav" }));
    const audio = normalizeFishStreamingWav(result.audio);
    const duration = wavDuration(audio);
    if (result.segments?.some(segment => segment.endSeconds > duration + .05)) delete result.segments;
    return { ...result, audio, format: "wav", mediaType: "audio/wav" as const };
  }
}

function unsupportedModel(modelId: string, modelType: "languageModel" | "embeddingModel" | "imageModel"): never {
  throw new NoSuchModelError({ modelId, modelType });
}

export function createFishAudio(
  options: FishAudioProviderSettings = {},
): ProviderV4 {
  const baseURL =
    withoutTrailingSlash(validateBaseURL(options.baseURL)) ??
    "https://api.fish.audio";
  const headers = () => ({
    Authorization: `Bearer ${loadApiKey({
      apiKey: options.apiKey,
      environmentVariableName: "FISH_AUDIO_API_KEY",
      description: "Fish Audio",
    })}`,
  });
  const speechModel = (modelId: string): SpeechModelV4 =>
    new FishAudioSpeechModel(modelId, {
      baseURL,
      headers,
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    });

  return {
    specificationVersion: "v4",
    languageModel: (modelId) => unsupportedModel(modelId, "languageModel"),
    embeddingModel: (modelId) => unsupportedModel(modelId, "embeddingModel"),
    imageModel: (modelId) => unsupportedModel(modelId, "imageModel"),
    speechModel,
  };
}
