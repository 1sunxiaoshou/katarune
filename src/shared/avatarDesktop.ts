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
  x: number,
  y: number,
  height: number,
  adjusting: z.boolean(),
  moving: z.boolean(),
  restored: z.optional(z.boolean()),
});
export type AvatarPresentation = z.infer<typeof avatarPresentationSchema>;
export type AvatarWindowReport = z.infer<typeof avatarWindowReportSchema>;
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
    "display",
    "open-model",
    "reload-model",
    "affect",
    "action",
    "gaze",
    "outline",
    "compact",
    "capsule-size",
  ]),
  value: z.optional(z.string().check(z.maxLength(256))),
  width: z.optional(z.number().check(z.gte(100), z.lte(220))),
});
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
