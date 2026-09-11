import * as z from "zod/mini";

export const speechSegmentSchema = z.object({
  text: z.string(),
  startSeconds: z.number().check(z.gte(0)),
  endSeconds: z.number().check(z.gte(0)),
});
export const speechSegmentsSchema = z.array(speechSegmentSchema).check(z.maxLength(100_000));
export type SpeechSegment = z.infer<typeof speechSegmentSchema>;

export function validateSpeechSegments(value: unknown): SpeechSegment[] | undefined {
  const parsed = speechSegmentsSchema.safeParse(value);
  if (!parsed.success || !parsed.data.length) return undefined;
  let end = 0;
  for (const segment of parsed.data) {
    if (segment.startSeconds < end || segment.endSeconds < segment.startSeconds) return undefined;
    end = segment.endSeconds;
  }
  return parsed.data;
}
