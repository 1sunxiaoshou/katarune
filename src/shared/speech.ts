import * as z from "zod/mini";

export const speechVoiceSchema = z
  .string()
  .check(z.minLength(1), z.maxLength(200));

export const voiceOptionSchema = z.strictObject({
  id: speechVoiceSchema,
  displayName: z.string().check(z.minLength(1), z.maxLength(200)),
  description: z.optional(
    z.string().check(z.minLength(1), z.maxLength(500)),
  ),
});

const voiceOptionsSchema = z
  .array(voiceOptionSchema)
  .check(
    z.minLength(1),
    z.maxLength(1_000),
    z.refine(
      (voices) => new Set(voices.map((voice) => voice.id)).size === voices.length,
      { error: "Speech voice IDs must be unique." },
    ),
  );

export const speechModelMetadataSchema = z
  .strictObject({
    voices: z.nullable(voiceOptionsSchema),
  });

export const speechModelSettingsSchema = z.strictObject({
  defaultVoiceId: z.nullable(speechVoiceSchema),
});

export type VoiceOption = Readonly<z.infer<typeof voiceOptionSchema>>;
export type SpeechModelMetadata = Readonly<
  z.infer<typeof speechModelMetadataSchema>
>;
export type SpeechModelSettings = Readonly<
  z.infer<typeof speechModelSettingsSchema>
>;

export function parseSpeechModelSettings(
  value: unknown,
): SpeechModelSettings | null {
  const result = speechModelSettingsSchema.safeParse(value);
  return result.success ? result.data : null;
}

export function parseSpeechModelMetadata(
  value: unknown,
): SpeechModelMetadata | null {
  const result = speechModelMetadataSchema.safeParse(value);
  return result.success ? result.data : null;
}
