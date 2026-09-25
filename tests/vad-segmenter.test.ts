import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
const require = createRequire(import.meta.url);
const { VadSegmenter } = require('../resources/vad-segmenter.cjs') as { VadSegmenter: new (vad: FakeVad) => {
  accept(samples: Float32Array): { speech: boolean; audio?: Float32Array }; reset(): void; history: Float32Array;
} };
class FakeVad {
  detected = false;
  segment: { start: number; samples: Float32Array } | undefined;
  reset() { this.detected = false; this.segment = undefined; }
  clear() { this.segment = undefined; }
  acceptWaveform(_samples: Float32Array) {}
  isDetected() { return this.detected; }
  isEmpty() { return !this.segment; }
  front() { return this.segment!; }
}
describe('bounded VAD utterance extraction', () => {
  it('keeps 300ms before detected speech and resets after one result', () => {
    const vad = new FakeVad(), segmenter = new VadSegmenter(vad);
    const audio = new Float32Array(16000).map((_, i) => i / 16000);
    segmenter.accept(audio);
    vad.segment = { start: 8000, samples: new Float32Array(4000) };
    const result = segmenter.accept(new Float32Array(512));
    expect(result.audio?.length).toBe(8800);
    expect(result.audio?.[0]).toBeCloseTo(audio[3200]!);
    expect(segmenter.accept(new Float32Array(512)).audio).toBeUndefined();
  });
  it('caps uninterrupted speech at 30 seconds including pre-roll', () => {
    const vad = new FakeVad(), segmenter = new VadSegmenter(vad); vad.detected = true;
    let result: { audio?: Float32Array } = {};
    for (let i = 0; i < 310 && !result.audio; i++) result = segmenter.accept(new Float32Array(1600).fill(0.5));
    expect(result.audio?.length).toBe(480000);
    expect(result.audio?.every(value => value === 0.5)).toBe(true);
  });
  it('does not accumulate unbounded silence or retain cancelled audio', () => {
    const vad = new FakeVad(), segmenter = new VadSegmenter(vad);
    for (let i = 0; i < 1000; i++) expect(segmenter.accept(new Float32Array(1600)).audio).toBeUndefined();
    expect(segmenter.history.length).toBe(512000);
    segmenter.accept(new Float32Array(1600).fill(0.5)); segmenter.reset();
    expect(segmenter.history.every(value => value === 0)).toBe(true);
  });
});
