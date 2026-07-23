import * as z from "zod/mini";

const characterNameSchema = z.string().check(z.minLength(1), z.maxLength(50));
const systemPromptSchema = z.string().check(z.maxLength(20_000));

export const characterSchema = z.strictObject({
  id: z.uuid(),
  name: characterNameSchema,
  portraitAssetId: z.nullable(z.uuid()),
  modelConfigId: z.nullable(z.uuid()),
  systemPrompt: systemPromptSchema,
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const characterListSchema = z.strictObject({
  characters: z.array(characterSchema),
});

export const characterIdRequestSchema = z.strictObject({
  id: z.uuid(),
});

export const updateCharacterRequestSchema = z.strictObject({
  id: z.uuid(),
  name: z.optional(characterNameSchema),
  modelConfigId: z.optional(z.nullable(z.uuid())),
  systemPrompt: z.optional(systemPromptSchema),
});

export const characterPortraitSchema = z.strictObject({
  characterId: z.uuid(),
  dataUrl: z.nullable(z.string().check(z.maxLength(15_000_000))),
});

export const characterPortraitImportResultSchema = z.strictObject({
  canceled: z.boolean(),
  character: z.nullable(characterSchema),
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
export type UpdateCharacterRequest = Readonly<z.infer<typeof updateCharacterRequestSchema>>;
export type CharacterPortrait = Readonly<z.infer<typeof characterPortraitSchema>>;
export type CharacterPortraitImportResult = Readonly<
  z.infer<typeof characterPortraitImportResultSchema>
>;
export type DefaultCharacterConfig = Readonly<z.infer<typeof defaultCharacterConfigSchema>>;
