import { describe, it, expect } from 'vitest';
import { asrRequestSchema, asrFrameSchema } from '../src/shared/asr';

describe('local ASR audio boundary', () => {
  const requestId = '56e4b357-8dc3-4da0-9e98-e16c511d95ce';
  it('accepts normalized PCM and rejects non-finite, unbounded, empty and oversized audio', () => {
    expect(asrRequestSchema.safeParse({ requestId, samples: new Float32Array([-.5, 0, 1]) }).success).toBe(true);
    for (const samples of [new Float32Array(), new Float32Array([NaN]), new Float32Array([Infinity]), new Float32Array([1.1]), new Float32Array(480_001)]) {
      expect(asrRequestSchema.safeParse({ requestId, samples }).success).toBe(false);
    }
  });
});


it('limits realtime frames to 200ms of normalized PCM', () => {
  const requestId = '56e4b357-8dc3-4da0-9e98-e16c511d95ce';
  expect(asrFrameSchema.safeParse({ requestId, samples: new Float32Array(3200) }).success).toBe(true);
  for (const samples of [new Float32Array(), new Float32Array(3201), new Float32Array([NaN]), new Float32Array([-2])]) {
    expect(asrFrameSchema.safeParse({ requestId, samples }).success).toBe(false);
  }
});
