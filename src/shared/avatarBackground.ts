import * as z from "zod/mini";

export const avatarBackgroundSchema = z.enum(["film", "cloud-observatory"]);
export type AvatarBackground = z.infer<typeof avatarBackgroundSchema>;
export const DEFAULT_AVATAR_BACKGROUND: AvatarBackground = "film";
export const AVATAR_BACKGROUND_OPTIONS = [
  { value: "film", label: "动态胶片" },
  { value: "cloud-observatory", label: "云端星象小客厅" },
] as const;
