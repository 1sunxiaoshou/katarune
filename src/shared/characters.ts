import * as z from "zod/mini";

const characterNameSchema = z.string().check(z.minLength(1), z.maxLength(50));
const systemPromptSchema = z.string().check(z.maxLength(20_000));
export const speechVoiceSchema = z.string().check(z.minLength(1), z.maxLength(200));
const portraitFocusSchema = z.number().check(z.gte(0), z.lte(1));
const portraitZoomSchema = z.number().check(z.gte(1), z.lte(3));

export const portraitFramingSchema = z.strictObject({
  focusX: portraitFocusSchema,
  focusY: portraitFocusSchema,
  zoom: portraitZoomSchema,
});

export const DEFAULT_PORTRAIT_FRAMING = {
  focusX: 0.5,
  focusY: 0,
  zoom: 1,
} as const;

function hasValidSpeechSelection(value: unknown): boolean {
  const selection = value as {
    readonly speechModelConfigId: string | null;
    readonly speechVoice: string | null;
  };
  return (
    (selection.speechModelConfigId === null) ===
    (selection.speechVoice === null)
  );
}

const validSpeechSelection = z.refine(hasValidSpeechSelection, {
  error: "Speech model and voice must either both be configured or both be null.",
});

export const characterSchema = z
  .strictObject({
    id: z.uuid(),
    name: characterNameSchema,
    portraitAssetId: z.nullable(z.uuid()),
    portraitFocusX: portraitFocusSchema,
    portraitFocusY: portraitFocusSchema,
    portraitZoom: portraitZoomSchema,
    modelConfigId: z.nullable(z.uuid()),
    speechModelConfigId: z.nullable(z.uuid()),
    speechVoice: z.nullable(speechVoiceSchema),
    systemPrompt: systemPromptSchema,
    createdAt: z.date(),
    updatedAt: z.date(),
  })
  .check(validSpeechSelection);

export const characterListSchema = z.strictObject({
  characters: z.array(characterSchema),
});

export const characterIdRequestSchema = z.strictObject({
  id: z.uuid(),
});

export const createCharacterRequestSchema = z
  .strictObject({
    name: characterNameSchema,
    modelConfigId: z.nullable(z.uuid()),
    speechModelConfigId: z.nullable(z.uuid()),
    speechVoice: z.nullable(speechVoiceSchema),
    systemPrompt: systemPromptSchema,
  })
  .check(validSpeechSelection);

export const updateCharacterRequestSchema = z.strictObject({
  id: z.uuid(),
  name: z.optional(characterNameSchema),
  modelConfigId: z.optional(z.nullable(z.uuid())),
  speechModelConfigId: z.optional(z.nullable(z.uuid())),
  speechVoice: z.optional(z.nullable(speechVoiceSchema)),
  systemPrompt: z.optional(systemPromptSchema),
});

export const stagedCharacterPortraitSchema = z.strictObject({
  id: z.uuid(),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  byteSize: z.int().check(z.positive()),
  originalName: z.string().check(z.minLength(1), z.maxLength(255)),
});

export const characterPortraitStageResultSchema = z.strictObject({
  canceled: z.boolean(),
  stage: z.nullable(stagedCharacterPortraitSchema),
});

export const characterPortraitStageIdRequestSchema = z.strictObject({
  stageId: z.uuid(),
});

export const characterPortraitCommitRequestSchema = z.discriminatedUnion("mode", [
  z.strictObject({
    mode: z.literal("existing"),
    id: z.uuid(),
    stageId: z.nullable(z.uuid()),
    framing: portraitFramingSchema,
  }),
  z.strictObject({
    mode: z.literal("draft"),
    character: createCharacterRequestSchema,
    stageId: z.uuid(),
    framing: portraitFramingSchema,
  }),
]);

export const deleteCharacterResultSchema = z.strictObject({
  deletedCharacterId: z.uuid(),
  deletedThreadCount: z.int().check(z.nonnegative()),
  replacementCharacter: characterSchema,
  activeCharacter: characterSchema,
});

export const defaultCharacterConfigSchema = z.strictObject({
  version: z.literal(1),
  character: z.strictObject({
    id: z.uuid(),
    name: characterNameSchema,
    modelConfigId: z.nullable(z.uuid()),
    systemPrompt: systemPromptSchema,
    portrait: z.nullable(
      z.strictObject({
        assetId: z.uuid(),
        file: z.string().check(z.minLength(1), z.maxLength(255)),
      }),
    ),
  }),
});

export type Character = Readonly<z.infer<typeof characterSchema>>;
export type CharacterList = Readonly<z.infer<typeof characterListSchema>>;
export type CharacterIdRequest = Readonly<z.infer<typeof characterIdRequestSchema>>;
export type CreateCharacterRequest = Readonly<z.infer<typeof createCharacterRequestSchema>>;
export type UpdateCharacterRequest = Readonly<z.infer<typeof updateCharacterRequestSchema>>;
export type PortraitFraming = Readonly<z.infer<typeof portraitFramingSchema>>;
export type StagedCharacterPortrait = Readonly<
  z.infer<typeof stagedCharacterPortraitSchema>
>;
export type CharacterPortraitStageResult = Readonly<
  z.infer<typeof characterPortraitStageResultSchema>
>;
export type CharacterPortraitStageIdRequest = Readonly<
  z.infer<typeof characterPortraitStageIdRequestSchema>
>;
export type CharacterPortraitCommitRequest = Readonly<
  z.infer<typeof characterPortraitCommitRequestSchema>
>;
export type DeleteCharacterResult = Readonly<z.infer<typeof deleteCharacterResultSchema>>;
export type DefaultCharacterConfig = Readonly<z.infer<typeof defaultCharacterConfigSchema>>;
