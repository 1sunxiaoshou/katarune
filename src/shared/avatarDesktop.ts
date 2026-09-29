import * as z from "zod/mini";
import type { AvatarStatus, AvatarCapabilities } from "./avatar";

const number = z.number();
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
  adjusting: z.boolean(),
  moving: z.boolean(),
  restored: z.optional(z.boolean()),
});
export const avatarSubtitleSchema = z.object({
  type: z.literal("subtitle"),
  epoch: z.number().check(z.int()),
  runId: z.string(),
  text: z.string().check(z.maxLength(20000)),
  user: z.boolean(),
});
export type AvatarPresentation = z.infer<typeof avatarPresentationSchema>;
export type AvatarWindowReport = z.infer<typeof avatarWindowReportSchema>;
export type AvatarSubtitle = z.infer<typeof avatarSubtitleSchema>;
export const desktopCommandSchema = z.object({
  operation: z.enum([
    "chat",
    "voice",
    "retry",
    "stop",
    "panel",
    "panel-ready",
    "close-panel",
    "adjust",
    "reset-layout",
    "open-model",
    "reload-model",
    "affect",
    "action",
    "gaze",
    "outline",
    "compact",
    "capsule-size",
    "subtitle-size",
  ]),
  value: z.optional(z.string().check(z.maxLength(256))),
  y: z.optional(number),
  width: z.optional(z.number().check(z.gte(100), z.lte(220))),
});
export type DesktopCommand = z.infer<typeof desktopCommandSchema>;
export type DesktopSurface = "capsule" | "panel" | "subtitle";
export type DesktopSnapshot = {
  status: AvatarStatus;
  capabilities: AvatarCapabilities | null;
  presentation: AvatarPresentation | null;
  subtitle: AvatarSubtitle | null;
  adjusting: boolean;
  compact: boolean;
  voiceLevel: number;
  panel: "more" | "help";
  panelPhase: "closed" | "preparing" | "open";
  panelRevision: number;
  error: string | null;
};

export interface AvatarDesktopApi {
  getState(): Promise<DesktopSnapshot>;
  command(command: DesktopCommand): Promise<void>;
  subscribe(listener: (state: DesktopSnapshot) => void): () => void;
}
