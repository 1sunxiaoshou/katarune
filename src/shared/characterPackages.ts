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
const playbackLayer = {
  layer: z.enum(["body", "upperBody", "head"]).optional(),
  blending: z.enum(["override", "additive"]).optional(),
  reference: path.optional(),
};
const oneShotPlaybackSchema = z.strictObject({ ...playbackLayer, kind: z.literal("oneShot"), motion: path, blendSeconds: z.number().min(0).max(2).optional() });
const loopPlaybackSchema = z.strictObject({ ...playbackLayer, kind: z.literal("loop"), enter: path.optional(), motion: path, exit: path.optional(), blendSeconds: z.number().min(0).max(2).optional() });
export const danceCameraKeySchema = z.strictObject({
  at: z.number().min(0).max(3600), view: z.enum(["overhead", "center", "closeup"]),
});
export type DanceCameraKey = z.infer<typeof danceCameraKeySchema>;
const cameraSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("track"), file: path,
    referenceHeight: z.number().positive().max(10).optional(),
    animation: text(200).optional(),
    shots: z.array(z.strictObject({ at: z.number().min(0).max(3600), node: text(200) })).min(1).max(256).superRefine((shots, context) => {
      shots.forEach((shot, index) => {
        if (index === 0 ? shot.at !== 0 : shot.at <= shots[index - 1]!.at)
          context.addIssue({ code: "custom", path: [index, "at"], message: "镜头段须从零开始并严格递增。" });
      });
    }).optional(),
  }),
  z.strictObject({ kind: z.literal("presets"), keys: z.array(danceCameraKeySchema).min(1).max(64).superRefine((keys, context) => {
    keys.forEach((key, index) => {
      if (index > 0 && key.at <= keys[index - 1]!.at)
        context.addIssue({ code: "custom", path: [index, "at"], message: "镜头时间必须严格递增。" });
    });
  }) }),
]);
export const performancePlaybackSchema = z.strictObject({
  kind: z.literal("performance"), motion: path, audio: path.optional(), subtitles: path.optional(),
  camera: cameraSchema.optional(),
  layer: z.literal("body").optional(), blending: z.literal("override").optional(),
  blendSeconds: z.number().min(0).max(2).optional(),
});
export type PerformancePlayback = z.infer<typeof performancePlaybackSchema>;
function validateActionBlending(value: z.infer<typeof oneShotPlaybackSchema> | z.infer<typeof loopPlaybackSchema>, context: z.RefinementCtx) {
  const blending = value.blending ?? (value.layer === "head" ? "additive" : "override");
  if ((value.layer ?? "body") === "body" && blending === "additive") context.addIssue({ code: "custom", path: ["blending"], message: "全身动作使用 override。" });
  if (value.reference && blending !== "additive") context.addIssue({ code: "custom", path: ["reference"], message: "reference 仅用于 additive。" });
}
export const actionPlaybackSchema = z.discriminatedUnion("kind", [oneShotPlaybackSchema, loopPlaybackSchema, performancePlaybackSchema]).superRefine((value, context) => {
  if (value.kind !== "performance") validateActionBlending(value, context);
});
export type ActionPlayback = z.infer<typeof actionPlaybackSchema>;
const actionKey = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(80);
const actionBindingsSchema = z.strictObject({
    greet: actionKey.optional(),
    nod: actionKey.optional(),
    shakeHead: actionKey.optional(),
    talk: actionKey.optional(),
    talkGesture: actionKey.optional(),
    think: actionKey.optional(),
    thinkGesture: actionKey.optional(),
    clap: actionKey.optional(),
    cheer: actionKey.optional(),
    encourage: actionKey.optional(),
    confused: actionKey.optional(),
    shrug: actionKey.optional(),
    point: actionKey.optional(),
    akimbo: actionKey.optional(),
    holdArms: actionKey.optional(),
    afraid: actionKey.optional(),
    downcast: actionKey.optional(),
    alert: actionKey.optional(),
    read: actionKey.optional(),
    whisper: actionKey.optional(),
});
export const ACTION_BINDING_KEYS = actionBindingsSchema.keyof().options;
const actionBindingLabels: Record<(typeof ACTION_BINDING_KEYS)[number], string> = {
  greet: "问候", nod: "点头", shakeHead: "摇头", talk: "交谈", talkGesture: "说话手势",
  think: "思考", thinkGesture: "思考手势", clap: "鼓掌", cheer: "欢呼", encourage: "鼓励",
  confused: "疑惑", shrug: "耸肩", point: "向前指", akimbo: "叉腰", holdArms: "抱臂",
  afraid: "害怕", downcast: "低落", alert: "警觉", read: "阅读", whisper: "低语",
};
export function actionBindingLabel(semantic: string): string | undefined {
  const key = ACTION_BINDING_KEYS.find(key => key === semantic);
  return key === undefined ? undefined : actionBindingLabels[key];
}
const manifestFields = {
  name: text(80),
  version: z.string().regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/),
  author: text(200).optional(),
  license: text(2000, true).optional(),
  portrait: path,
  thumbnail: path.optional(),
  model: path,
};
const packageActionSchema = z.strictObject({
  key: actionKey, name: text(80), description: text(1000, true), playback: actionPlaybackSchema,
});
export const characterPackageManifestSchema = z.strictObject({
  ...manifestFields,
  formatVersion: z.literal(3),
  actions: z.array(packageActionSchema).max(256),
  idle: z.strictObject({ base: actionKey.optional(), variations: z.array(actionKey).max(32).optional() }).optional(),
  bindings: actionBindingsSchema.optional(),
}).superRefine((manifest, context) => {
  const actions = new Map<string, typeof manifest.actions[number]>();
  manifest.actions.forEach((action, index) => {
    if (actions.has(action.key)) context.addIssue({ code: "custom", path: ["actions", index, "key"], message: "包内动作标识必须唯一。" });
    actions.set(action.key, action);
  });
  const check = (key: string, path: (string | number)[], kind?: "oneShot" | "loop") => {
    const action = actions.get(key);
    if (!action) context.addIssue({ code: "custom", path, message: "引用的动作不存在。" });
    else if (kind ? action.playback.kind !== kind : action.playback.kind === "performance")
      context.addIssue({ code: "custom", path, message: kind === "loop" ? "基础待机必须引用循环动作。" : kind === "oneShot" ? "待机变化必须引用单次动作。" : "固定用途必须引用普通动作。" });
    if (kind && action && ((action.playback.layer ?? "body") !== "body" || (action.playback.blending ?? "override") !== "override" || (action.playback.kind === "loop" && (action.playback.enter || action.playback.exit))))
      context.addIssue({ code: "custom", path, message: "自动待机使用全身覆盖，基础循环不包含进入或退出段。" });
  };
  if (manifest.idle?.base) check(manifest.idle.base, ["idle", "base"], "loop");
  const variations = manifest.idle?.variations ?? [];
  if (new Set(variations).size !== variations.length) context.addIssue({ code: "custom", path: ["idle", "variations"], message: "待机变化不能重复引用。" });
  variations.forEach((key, i) => check(key, ["idle", "variations", i], "oneShot"));
  for (const [role, key] of Object.entries(manifest.bindings ?? {})) if (key !== undefined) check(key, ["bindings", role]);
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
  actions: z.array(
    z.strictObject({
      id: z.uuid(),
      name: z.string(),
      description: z.string(),
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
  formatVersion: 3;
  id: string;
  version: string;
  model: string;
  idle: { base?: string; variations: string[] };
  actions: CharacterPackage["actions"];
  bindings: { role: string; actionId: string }[];
}

export function playbackFiles(playback: ActionPlayback): string[] {
  return [playback.motion, ...(playback.kind === "loop" ? [playback.enter, playback.exit] : []), ...(playback.kind !== "performance" ? [playback.reference] : [])].filter((file): file is string => file !== undefined);
}
export function primaryPlaybackFile(playback: ActionPlayback): string { return playback.motion; }
export function packageAnimationFiles(manifest: CharacterPackageManifest): string[] {
  return [...new Set(manifest.actions.flatMap(action => playbackFiles(action.playback)))];
}
export function packageAudioFiles(manifest: CharacterPackageManifest): string[] {
  return [...new Set(manifest.actions.flatMap(action => action.playback.kind === "performance" && action.playback.audio ? [action.playback.audio] : []))];
}
export function packageSubtitleFiles(manifest: CharacterPackageManifest): string[] {
  return [...new Set(manifest.actions.flatMap(action => action.playback.kind === "performance" && action.playback.subtitles ? [action.playback.subtitles] : []))];
}
export function packageCameraFiles(manifest: CharacterPackageManifest): string[] {
  return [...new Set(manifest.actions.flatMap(action => action.playback.kind === "performance" && action.playback.camera?.kind === "track" ? [action.playback.camera.file] : []))];
}
