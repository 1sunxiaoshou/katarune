import type { SpeechModelV4 } from "@ai-sdk/provider";
import type { SpeechSegment } from "../../shared/speechTiming";

export type SpeechStreamEvent =
  | { type: "format"; sampleRate: number; channels: 1; encoding: "pcm-s16le" }
  | { type: "audio"; audio: Uint8Array }
  | { type: "alignment"; segments: SpeechSegment[] }
  | { type: "end" };

export interface StreamingSpeechModel {
  streamSpeech(options: Parameters<SpeechModelV4["doGenerate"]>[0]): AsyncIterable<SpeechStreamEvent>;
}

export function hasStreamingSpeech(model: object): model is SpeechModelV4 & StreamingSpeechModel {
  return "streamSpeech" in model && typeof model.streamSpeech === "function";
}

export function pcmWav(audio: Uint8Array, sampleRate: number): Uint8Array {
  if (!audio.length || audio.length % 2) throw new Error("Incomplete PCM audio.");
  const wav = Buffer.alloc(44 + audio.length);
  wav.write("RIFF"); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24); wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36);
  wav.writeUInt32LE(audio.length, 40); wav.set(audio, 44);
  return wav;
}
