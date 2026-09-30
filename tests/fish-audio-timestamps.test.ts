import { describe, it, expect } from "vitest";
import { readFishTimestampStream } from "../src/main/ai/fishAudioTimestamps";
import { extractSpokenText } from "../src/main/speech/spokenText";
import { createFishAudio } from "../src/main/ai/fishAudioProvider";
import { hasTimestampedSpeech } from "../src/main/ai/timestampedSpeech";
import { hasStreamingSpeech } from "../src/main/ai/streamingSpeech";
import { normalizeFishStreamingWav, wavDuration } from "../src/main/ai/wavDuration";

function wav() {
  const data = Buffer.alloc(32044); data.write("RIFF"); data.writeUInt32LE(32036, 4); data.write("WAVEfmt ", 8);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
  data.writeUInt32LE(16000, 24); data.writeUInt32LE(32000, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34);
  data.write("data", 36); data.writeUInt32LE(32000, 40); return data;
}

function stream(text: string) {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream<Uint8Array>({ start(controller) {
    for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
    controller.close();
  } });
}
const event = (seq: number, offset: number, alignment: unknown, byte = 1) =>
  `data: ${JSON.stringify({ audio_base64: Buffer.from([byte]).toString("base64"), alignment,
    chunk_seq: seq, chunk_audio_offset_sec: offset })}\r\n\r\n`;

describe("Fish timestamp stream", () => {
  it("delivers aligned PCM before the response closes and joins split samples", async () => {
    let source!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({ start(controller) { source = controller; } });
    const fetch = async (_input: unknown, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toMatchObject({ format: "pcm", sample_rate: 24000, latency: "balanced" });
      return new Response(body);
    };
    const model = createFishAudio({ apiKey: "test-only", fetch }).speechModel!("s2.1-pro-free");
    if (!hasStreamingSpeech(model)) throw new Error("Missing streaming capability");
    const iterator = model.streamSpeech({ text: "你好" })[Symbol.asyncIterator]();
    expect((await iterator.next()).value).toMatchObject({ type: "format", sampleRate: 24000 });
    const first = iterator.next();
    source.enqueue(new TextEncoder().encode(event(0, 0, null, 1) + event(0, 0, null, 2)));
    expect((await first).value).toEqual({ type: "audio", audio: new Uint8Array([1, 2]) });
    source.close();
    expect((await iterator.next()).value).toEqual({ type: "alignment", segments: [] });
    expect((await iterator.next()).value).toEqual({ type: "end" });
    expect((await iterator.next()).done).toBe(true);
  });
  it("keeps the ordinary endpoint independent from timestamp synthesis", async () => {
    const requests: string[] = [];
    const audio = wav();
    const model = createFishAudio({ apiKey: "test-only", fetch: async input => {
      const url = String(input); requests.push(url);
      return new Response(url.endsWith("with-timestamp") ? `data: ${JSON.stringify({
        audio_base64: audio.toString("base64"), chunk_seq: 0, chunk_audio_offset_sec: 0,
        alignment: { segments: [{ text: "twelve", start: 0, end: .5 }] },
      })}\n\n` : new Uint8Array(audio));
    } }).speechModel!("s2.1-pro-free");
    await model.doGenerate({ text: "12", voice: "test", outputFormat: "wav" });
    expect(hasTimestampedSpeech(model)).toBe(true);
    if (!hasTimestampedSpeech(model)) throw new Error("missing capability");
    expect((await model.generateWithTimestamps({ text: "12", voice: "test" })).segments?.[0]?.text).toBe("twelve");
    expect(requests.map(url => new URL(url).pathname)).toEqual(["/v1/tts", "/v1/tts/stream/with-timestamp"]);
  });
  it("normalizes only the observed streaming sentinel and rejects ordinary truncation", () => {
    const audio = wav(); audio.writeUInt32LE(0xffffff24, 4); audio.writeUInt32LE(0xffffff00, 40);
    expect(wavDuration(normalizeFishStreamingWav(audio))).toBe(1);
    expect(() => wavDuration(wav().subarray(0, 100))).toThrow("Truncated");
  });
  it("keeps repeated provider text at distinct offsets", async () => {
    const alignment = { segments: [{ text: "はい", start: 0, end: .5 }] };
    const result = await readFishTimestampStream(stream(event(0, 0, alignment) + event(1, 1, alignment)));
    expect(result.segments?.map(s => s.startSeconds)).toEqual([0, 1]);
  });
  it("keeps all audio and replaces cumulative snapshots across UTF8 transport boundaries", async () => {
    const result = await readFishTimestampStream(stream(
      event(0, 0, null) + event(0, 0, { segments: [{ text: "你", start: 0, end: .1 }] }, 2)
      + event(0, 0, { segments: [{ text: "你好", start: 0, end: .2 }] }, 3)
      + event(1, .3, { segments: [{ text: "12", start: 0, end: .1 }] }, 4).trimEnd(),
    ));
    expect([...result.audio]).toEqual([1, 2, 3, 4]);
    expect(result.segments).toEqual([
      { text: "你好", startSeconds: 0, endSeconds: .2 },
      { text: "12", startSeconds: .3, endSeconds: .4 },
    ]);
  });
  it("preserves audio when alignment is invalid", async () => {
    expect((await readFishTimestampStream(stream(event(0, 0, { segments: [{ text: "bad", start: 2, end: 1 }] })))).segments).toBeUndefined();
  });
  it("accepts a later valid replacement for an invalid alignment snapshot", async () => {
    const result = await readFishTimestampStream(stream(event(0, 0, { segments: "invalid" })
      + event(0, 0, { segments: [{ text: "fixed", start: 0, end: .5 }] })));
    expect(result.segments?.[0]?.text).toBe("fixed");
  });
  it("preserves audio when offset metadata is invalid", async () => {
    const result = await readFishTimestampStream(stream('data: {"audio_base64":"AQ==","chunk_seq":0,"chunk_audio_offset_sec":-1,"alignment":{"segments":[]}}'));
    expect([...result.audio]).toEqual([1]); expect(result.segments).toBeUndefined();
  });
  it("rejects partial JSON at EOF", async () => {
    await expect(readFishTimestampStream(stream('data: {"audio_base64":'))).rejects.toThrow();
  });
  it("extracts link labels and excludes code blocks and images", () => {
    expect(extractSpokenText('**你好** [链接](https://example.com) ![图](x)\n\n```js\nsecret()\n```')).toBe("你好 链接");
  });
});
