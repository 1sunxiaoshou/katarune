import { EventSourceParserStream } from "@ai-sdk/provider-utils";
import * as z from "zod/mini";
import { validateSpeechSegments, type SpeechSegment } from "../../shared/speechTiming";

const eventSchema = z.object({
  audio_base64: z.string(),
  alignment: z.optional(z.unknown()),
  chunk_seq: z.optional(z.unknown()),
  chunk_audio_offset_sec: z.optional(z.unknown()),
});
const timingSchema = z.object({
  chunk_seq: z.number().check(z.int(), z.gte(0)),
  chunk_audio_offset_sec: z.number().check(z.gte(0)),
});
const alignmentSchema = z.object({ segments: z.array(z.object({
  text: z.string(), start: z.number(), end: z.number(),
})) });

export async function* streamFishTimestamps(body: ReadableStream<Uint8Array>) {
  const snapshots = new Map<number, SpeechSegment[] | undefined>();
  let invalidAlignment = false;
  let byteLength = 0;
  const current = () => invalidAlignment || [...snapshots.values()].some(value => !value) ? [] : validateSpeechSegments(
    [...snapshots.entries()].sort(([a], [b]) => a - b).flatMap(([, value]) => value ?? []),
  ) ?? [];
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const reader = body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) { controller.enqueue(chunk); },
    flush(controller) { controller.enqueue(new Uint8Array([10, 10])); },
  })).pipeThrough(new TransformStream<Uint8Array, string>({
    transform(chunk, controller) { controller.enqueue(decoder.decode(chunk, { stream: true })); },
    flush(controller) { controller.enqueue(decoder.decode()); },
  })).pipeThrough(new EventSourceParserStream()).getReader();
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      if (next.value.data.length > 16 * 1024 * 1024) throw new Error("Speech event exceeds limit.");
      const event = eventSchema.parse(JSON.parse(next.value.data));
      if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(event.audio_base64))
        throw new Error("Invalid Fish audio encoding.");
      const chunk = Buffer.from(event.audio_base64, "base64");
      byteLength += chunk.length;
      if (byteLength > 128 * 1024 * 1024) throw new Error("Speech audio exceeds limit.");
      if (event.alignment !== null && event.alignment !== undefined) {
        const timing = timingSchema.safeParse(event);
        const alignment = alignmentSchema.safeParse(event.alignment);
        if (!timing.success) invalidAlignment = true;
        else snapshots.set(timing.data.chunk_seq, alignment.success ? alignment.data.segments.map(segment => ({
          text: segment.text,
          startSeconds: segment.start + timing.data.chunk_audio_offset_sec,
          endSeconds: segment.end + timing.data.chunk_audio_offset_sec,
        })) : undefined);
        yield { type: "alignment" as const, segments: current() };
      }
      if (chunk.length) yield { type: "audio" as const, audio: new Uint8Array(chunk) };
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  yield { type: "alignment" as const, segments: current() };
}

export async function readFishTimestampStream(body: ReadableStream<Uint8Array>) {
  const audio: Uint8Array[] = [];
  let segments: SpeechSegment[] = [];
  for await (const event of streamFishTimestamps(body)) {
    if (event.type === "audio") audio.push(event.audio);
    else segments = event.segments;
  }
  return { audio: new Uint8Array(Buffer.concat(audio)), ...(segments.length ? { segments } : {}) };
}
