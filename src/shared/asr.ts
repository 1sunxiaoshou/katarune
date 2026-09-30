import * as z from 'zod/mini';

export const ASR_CHANNELS = {
  prepare: 'asr:prepare',
  transcribe: 'asr:transcribe',
  cancel: 'asr:cancel',
  realtime: 'asr:realtime',
  frame: 'asr:frame',
  reset: 'asr:reset',
  progress: 'asr:progress',
} as const;
export const ASR_SAMPLE_RATE = 16_000;
export const ASR_MAX_SECONDS = 30;
export const asrRequestIdSchema = z.strictObject({ requestId: z.uuid() });
export const asrRequestSchema = z.strictObject({
  requestId: z.uuid(),
  samples: z.instanceof(Float32Array).check(z.refine(
    (samples) => samples.length > 0 && samples.length <= ASR_SAMPLE_RATE * ASR_MAX_SECONDS
      && samples.every((value) => Number.isFinite(value) && Math.abs(value) <= 1),
    'Invalid ASR audio',
  )),
});
export const asrResultSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('success'), text: z.string().check(z.maxLength(20_000)), speech: z.optional(z.boolean()), complete: z.optional(z.boolean()) }),
  z.strictObject({ status: z.literal('cancelled') }),
  z.strictObject({ status: z.literal('error'), message: z.string().check(z.maxLength(1000)) }),
]);
export type AsrRequest = z.infer<typeof asrRequestSchema>;
export type AsrResult = z.infer<typeof asrResultSchema>;
export const realtimeAsrRequestSchema = z.strictObject({
  requestId: z.uuid(), characterId: z.uuid(), threadId: z.string().check(z.minLength(1)),
});
export type RealtimeAsrRequest = z.infer<typeof realtimeAsrRequestSchema>;
export const asrFrameSchema = z.strictObject({
  requestId: z.uuid(),
  samples: z.instanceof(Float32Array).check(z.refine(samples => samples.length > 0 && samples.length <= 3200
    && samples.every(value => Number.isFinite(value) && Math.abs(value) <= 1), 'Invalid audio frame')),
});
