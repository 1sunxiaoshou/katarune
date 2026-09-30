import type { SpeechModelV4 } from "@ai-sdk/provider";
import type { SpeechSegment } from "../../shared/speechTiming";

export interface TimestampedSpeechAudio {
  audio: Uint8Array;
  format: string;
  mediaType: `audio/${string}`;
  segments?: SpeechSegment[];
}

export interface TimestampedSpeechModel {
  generateWithTimestamps(options: Parameters<SpeechModelV4["doGenerate"]>[0]): Promise<TimestampedSpeechAudio>;
}

export function hasTimestampedSpeech(model: object): model is SpeechModelV4 & TimestampedSpeechModel {
  return "generateWithTimestamps" in model && typeof model.generateWithTimestamps === "function";
}
