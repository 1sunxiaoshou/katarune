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
const playbackLayer = {
  layer: z.enum(["body", "upperBody", "head"]).optional(),
  blending: z.enum(["override", "additive"]).optional(),
  reference: path.optional(),
};
export const actionPlaybackSchema = z.discriminatedUnion("kind", [
  z.strictObject({ ...playbackLayer, kind: z.literal("oneShot"), file: path, blendSeconds: z.number().min(0).max(2).optional() }),
  z.strictObject({ ...playbackLayer, kind: z.literal("loop"), enter: path.optional(), loop: path, exit: path.optional(), blendSeconds: z.number().min(0).max(2).optional() }),
]).superRefine((value, context) => {
  const blending = value.blending ?? (value.layer === "head" ? "additive" : "override");
  if ((value.layer ?? "body") === "body" && blending === "additive") context.addIssue({ code: "custom", path: ["blending"], message: "全身动作使用 override。" });
  if (value.reference && blending !== "additive") context.addIssue({ code: "custom", path: ["reference"], message: "reference 仅用于 additive。" });
});
export type ActionPlayback = z.infer<typeof actionPlaybackSchema>;
const systemBehaviorsSchema = z.strictObject({
    greet: actionPlaybackSchema.optional(),
    nod: actionPlaybackSchema.optional(),
    shakeHead: actionPlaybackSchema.optional(),
    talk: actionPlaybackSchema.optional(),
    talkGesture: actionPlaybackSchema.optional(),
    think: actionPlaybackSchema.optional(),
    thinkGesture: actionPlaybackSchema.optional(),
    clap: actionPlaybackSchema.optional(),
    cheer: actionPlaybackSchema.optional(),
    encourage: actionPlaybackSchema.optional(),
    confused: actionPlaybackSchema.optional(),
    shrug: actionPlaybackSchema.optional(),
    point: actionPlaybackSchema.optional(),
    akimbo: actionPlaybackSchema.optional(),
    holdArms: actionPlaybackSchema.optional(),
    afraid: actionPlaybackSchema.optional(),
    downcast: actionPlaybackSchema.optional(),
    alert: actionPlaybackSchema.optional(),
    read: actionPlaybackSchema.optional(),
    whisper: actionPlaybackSchema.optional(),
});
export const SYSTEM_ACTION_KEYS = systemBehaviorsSchema.keyof().options;
const actionKey = text(80).refine(value => value === value.trim(), "动作标识不能有首尾空格。");
const manifestFields = {
  name: text(80),
  version: z.string().regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/),
  author: text(200).optional(),
  license: text(2000, true).optional(),
  portrait: path,
  thumbnail: path.optional(),
  model: path,
};
const baseSystemActions = {
    idle: systemAction.optional(),
    idle_variations: z.array(systemAction).max(32).optional(),
};
const customAction = z.strictObject({
  key: actionKey.optional(), name: text(80), description: text(1000, true), playback: actionPlaybackSchema,
});
export const characterPackageManifestSchema = z.strictObject({
  ...manifestFields,
  formatVersion: z.literal(2),
  systemActions: z.strictObject({
    ...baseSystemActions,
    ...systemBehaviorsSchema.shape,
  }),
  customActions: z.array(customAction).max(256),
}).superRefine((manifest, context) => {
  const keys = new Set<string>();
  manifest.customActions.forEach((action, index) => {
    const key = action.key ?? action.name;
    if (key !== key.trim() || keys.has(key)) context.addIssue({ code: "custom", path: ["customActions", index, "key"], message: "自定义动作标识必须唯一且无首尾空格；重名动作请填写不同 key。" });
    keys.add(key);
  });
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
      key: actionKey,
      playback: actionPlaybackSchema,
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
  formatVersion: 2;
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
    key: string;
    playback: ActionPlayback;
  }[];
  systemBehaviors?: { id: string; name: string; description: string; playback: ActionPlayback }[];
}

export function playbackFiles(playback: ActionPlayback): string[] {
  return [...(playback.kind === "oneShot" ? [playback.file] : [playback.enter, playback.loop, playback.exit]), playback.reference].filter((file): file is string => file !== undefined);
}
export function primaryPlaybackFile(playback: ActionPlayback): string {
  return playback.kind === "oneShot" ? playback.file : playback.loop;
}
export function packageAnimationFiles(manifest: CharacterPackageManifest): string[] {
  const files = [manifest.systemActions.idle?.file, ...(manifest.systemActions.idle_variations ?? []).map(action => action.file)].filter((file): file is string => file !== undefined);
  for (const key of SYSTEM_ACTION_KEYS) { const playback = manifest.systemActions[key]; if (playback) files.push(...playbackFiles(playback)); }
  for (const action of manifest.customActions) files.push(...playbackFiles(action.playback));
  return [...new Set(files)];
}
