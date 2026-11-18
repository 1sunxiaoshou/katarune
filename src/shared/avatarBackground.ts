import * as z from "zod/mini";

export const avatarBackgroundSchema = z.enum(["film", "cloud-observatory", "island-coast"]);
export type AvatarBackground = z.infer<typeof avatarBackgroundSchema>;
export const DEFAULT_AVATAR_BACKGROUND: AvatarBackground = "film";
export const AVATAR_BACKGROUND_OPTIONS = [
  { value: "film", label: "动态胶片" },
  { value: "cloud-observatory", label: "背景1" },
  { value: "island-coast", label: "异世界海岸" },
] as const;
