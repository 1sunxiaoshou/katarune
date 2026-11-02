import * as z from "zod/mini";

export const AVATAR_CAMERA_VIEWS = ["fullbody", "center", "closeup", "overhead", "side"] as const;
export const avatarCameraViewSchema = z.enum(AVATAR_CAMERA_VIEWS);
export type AvatarCameraView = z.infer<typeof avatarCameraViewSchema>;
export const AVATAR_CAMERA_OPTIONS = [
  { value: "fullbody", label: "全身" },
  { value: "center", label: "对话" },
  { value: "closeup", label: "特写" },
  { value: "overhead", label: "俯视" },
  { value: "side", label: "侧拍" },
] as const satisfies readonly { value: AvatarCameraView; label: string }[];
