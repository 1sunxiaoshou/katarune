import * as z from "zod/mini";
import { speechVoiceSchema } from "./speech";

const characterNameSchema = z.string().check(z.minLength(1), z.maxLength(50));
const systemPromptSchema = z.string().check(z.maxLength(20_000));
export { speechVoiceSchema } from "./speech";
function hasValidSpeechSelection(value: unknown): boolean {
  const selection = value as {
    readonly speechModelConfigId: string | null;
    readonly speechVoice: string | null;
    readonly useDefaultSpeechVoice?: boolean;
  };
  return (
    selection.useDefaultSpeechVoice === true ||
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
    packageId: z.optional(z.string()),
    packagePortraitAssetId: z.optional(z.nullable(z.uuid())),
    packageThumbnailAssetId: z.optional(z.nullable(z.uuid())),
    portraitAssetId: z.nullable(z.uuid()),
    modelConfigId: z.nullable(z.uuid()),
    speechModelConfigId: z.nullable(z.uuid()),
    speechVoice: z.nullable(speechVoiceSchema),
    useDefaultSpeechModel: z.boolean(),
    useDefaultSpeechVoice: z.boolean(),
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
    useDefaultSpeechModel: z.optional(z.boolean()),
    useDefaultSpeechVoice: z.optional(z.boolean()),
    systemPrompt: systemPromptSchema,
  })
  .check(validSpeechSelection);

export const updateCharacterRequestSchema = z.strictObject({
  id: z.uuid(),
  name: z.optional(characterNameSchema),
  modelConfigId: z.optional(z.nullable(z.uuid())),
  speechModelConfigId: z.optional(z.nullable(z.uuid())),
  speechVoice: z.optional(z.nullable(speechVoiceSchema)),
  useDefaultSpeechModel: z.optional(z.boolean()),
  useDefaultSpeechVoice: z.optional(z.boolean()),
  systemPrompt: z.optional(systemPromptSchema),
});

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
export type DeleteCharacterResult = Readonly<z.infer<typeof deleteCharacterResultSchema>>;
export type DefaultCharacterConfig = Readonly<z.infer<typeof defaultCharacterConfigSchema>>;
