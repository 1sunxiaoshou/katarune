import { z } from "zod";

export const DEFAULT_PACKAGE_ID = "builtin:default";
export const packageIdSchema = z.union([
  z.literal(DEFAULT_PACKAGE_ID),
  z.uuid(),
]);
const text = (max: number, multiline = false) =>
  z
    .string()
    .refine(
      (value) =>
        value.trim().length > 0 &&
        [...value].length <= max &&
        !(
          multiline
            ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/
            : /[\u0000-\u001f\u007f]/
        ).test(value),
      "文本为空、过长或包含控制字符。",
    );
export function isPackagePath(value: string): boolean {
  return (
    [...value].length <= 240 &&
    value
      .split("/")
      .every(
        (part) =>
          part.length > 0 &&
          part !== "." &&
          part !== ".." &&
          !/[\\:<>"|?*\u0000-\u001f\u007f]/.test(part) &&
          !/[ .]$/.test(part) &&
          !/^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(part),
      )
  );
}
const path = z.string().refine(isPackagePath, "必须使用安全的包内相对路径。");
const systemAction = z.strictObject({ file: path });
export const characterPackageManifestSchema = z.strictObject({
  formatVersion: z.literal(1),
  name: text(80),
  version: z.string().regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/),
  author: text(200).optional(),
  license: text(2000, true).optional(),
  portrait: path,
  thumbnail: path.optional(),
  model: path,
  systemActions: z.strictObject({
    idle: systemAction.optional(),
    idle_variations: z.array(systemAction).max(32).optional(),
  }),
  customActions: z
    .array(
      z.strictObject({
        name: text(80),
        description: text(1000, true),
        file: path,
      }),
    )
    .max(256),
});
export type CharacterPackageManifest = z.infer<
  typeof characterPackageManifestSchema
>;
export const characterPackageSchema = z.strictObject({
  id: packageIdSchema,
  builtin: z.boolean(),
  manifest: characterPackageManifestSchema,
  portraitAssetId: z.uuid(),
  thumbnailAssetId: z.uuid().nullable(),
  customActions: z.array(
    z.strictObject({
      id: z.uuid(),
      name: z.string(),
      description: z.string(),
      file: z.string(),
    }),
  ),
  referenceCount: z.number().int().nonnegative(),
});
export type CharacterPackage = z.infer<typeof characterPackageSchema>;
export const packageListSchema = z.array(characterPackageSchema);
export const packageIdRequestSchema = z.strictObject({ id: packageIdSchema });
export const packageBindSchema = z.strictObject({
  characterId: z.uuid(),
  packageId: packageIdSchema,
});
export const packageImportRequestSchema = z.strictObject({
  requestId: z.uuid(),
});
export const packageImportResultSchema = z.strictObject({
  canceled: z.boolean(),
  package: characterPackageSchema.nullable(),
});
export const packageProgressSchema = z.strictObject({
  requestId: z.uuid(),
  phase: z.enum(["extracting", "validating", "publishing"]),
  files: z.number().int().nonnegative(),
});
export type PackageProgress = z.infer<typeof packageProgressSchema>;
export const PACKAGE_CHANNELS = {
  list: "character-packages:list",
  detail: "character-packages:detail",
  import: "character-packages:import",
  cancel: "character-packages:cancel",
  remove: "character-packages:delete",
  bind: "character-packages:bind",
  progress: "character-packages:progress",
} as const;

// Main -> Unity only. Paths are never passed to renderer.
export interface RuntimeCharacterPackage {
  id: string;
  version: string;
  model: string;
  idle: string;
  idleVariations: string[];
  customActions: {
    id: string;
    name: string;
    description: string;
    file: string;
  }[];
}
