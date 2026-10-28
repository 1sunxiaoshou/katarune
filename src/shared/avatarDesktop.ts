import type { DiagnosticsApi } from "./diagnostics";
import * as z from "zod/mini";
import type { AvatarStatus, AvatarCapabilities } from "./avatar";

const number = z.number();
export const avatarDisplayModeSchema = z.enum(["desktop", "immersive"]);
export const avatarCameraViewSchema = z.enum(["overhead", "center", "closeup"]);
export type AvatarDisplayMode = z.infer<typeof avatarDisplayModeSchema>;
export type AvatarCameraView = z.infer<typeof avatarCameraViewSchema>;
export const desktopRectSchema = z.object({
  x: number,
  y: number,
  width: z.number().check(z.gt(0), z.lte(32000)),
  height: z.number().check(z.gt(0), z.lte(32000)),
});
export type DesktopRect = z.infer<typeof desktopRectSchema>;
export const avatarPresentationSchema = z.object({
  type: z.literal("presentation"),
  modelName: z.string(),
  modelPath: z.string(),
  loading: z.boolean(),
  affect: z.string(),
  action: z.string(),
  playingActions: z.optional(z.array(z.string().check(z.minLength(1), z.maxLength(256))).check(z.maxLength(3))),
  gaze: z.boolean(),
  outline: z.boolean(),
  error: z.string(),
  referenceWidth: number,
  referenceHeight: number,
});
export const avatarWindowReportSchema = z.object({
  type: z.literal("window-state"),
  requestId: z.string(),
  layoutId: z.string(),
  userChanged: z.boolean(),
  rect: desktopRectSchema,
  yaw: number,
  pitch: number,
  x: number,
  y: number,
  height: number,
  adjusting: z.boolean(),
  moving: z.boolean(),
  restored: z.optional(z.boolean()),
  mode: avatarDisplayModeSchema,
  cameraView: avatarCameraViewSchema,
});
export type AvatarPresentation = z.infer<typeof avatarPresentationSchema>;
export type AvatarWindowReport = z.infer<typeof avatarWindowReportSchema>;
export const desktopCommandSchema = z.object({
  operation: z.enum([
    "chat",
    "input",
    "voice",
    "retry",
    "stop",
    "panel",
    "panel-ready",
    "close-panel",
    "adjust",
    "reset-layout",
    "display",
    "open-model",
    "reload-model",
    "affect",
    "action",
    "action-stop",
    "gaze",
    "outline",
    "compact",
    "capsule-size",
    "mode",
    "camera-view",
  ]),
  value: z.optional(z.string().check(z.maxLength(256))),
  width: z.optional(z.number().check(z.gte(100), z.lte(520))),
});
export const desktopTextSchema = z.object({
  sessionId: z.uuid(),
  text: z.string().check(z.minLength(1), z.maxLength(20_000)),
});
export const desktopTextResultSchema = z.object({ error: z.nullable(z.string()) });
export type DesktopText = z.infer<typeof desktopTextSchema>;
export type DesktopTextResult = z.infer<typeof desktopTextResultSchema>;
export type DesktopCommand = z.infer<typeof desktopCommandSchema>;
export type DesktopSurface = "capsule" | "panel";
export type DesktopSnapshot = {
  status: AvatarStatus;
  capabilities: AvatarCapabilities | null;
  presentation: AvatarPresentation | null;
  displays: { id: string; name: string }[];
  selectedDisplay: string;
  adjusting: boolean;
  compact: boolean;
  inputOpen: boolean;
  inputAnchorRight: boolean;
  textSessionId: string | null;
  mode: AvatarDisplayMode;
  cameraView: AvatarCameraView;
  voiceLevel: number;
  panel: "more" | "help";
  panelPhase: "closed" | "preparing" | "open";
  panelRevision: number;
  error: string | null;
};

export interface AvatarDesktopApi extends DiagnosticsApi {
  getState(): Promise<DesktopSnapshot>;
  command(command: DesktopCommand): Promise<void>;
  submitText(request: DesktopText): Promise<DesktopTextResult>;
  subscribe(listener: (state: DesktopSnapshot) => void): () => void;
}
