import * as z from "zod/mini";

export const avatarBindingSchema = z.object({
  characterId: z.uuid(),
  threadId: z.string().check(z.minLength(1)),
});
export type AvatarBinding = z.infer<typeof avatarBindingSchema>;
export const avatarStatusSchema = z.object({
  busy: z.optional(z.boolean()),
  phase: z.enum(["stopped", "starting", "ready", "error"]),
  binding: z.nullable(avatarBindingSchema),
  error: z.nullable(z.string()),
  voice: z.optional(z.object({
    desired: z.boolean(),
    phase: z.enum(["idle", "preparing", "listening", "recording", "transcribing", "waiting", "error"]),
    error: z.nullable(z.string()),
  })),
  playback: z.optional(z.object({ runId: z.string(), state: z.enum(["playing", "paused", "completed", "interrupted"]) })),
});
export type AvatarStatus = z.infer<typeof avatarStatusSchema>;
export const avatarVoiceStateSchema = z.object({
  binding: avatarBindingSchema,
  phase: z.enum(["idle", "preparing", "listening", "recording", "transcribing", "waiting", "error"]),
  error: z.nullable(z.string()),
  level: z.optional(z.number().check(z.gte(0), z.lte(1))),
});
export const avatarPlaybackControlSchema = z.object({
  binding: avatarBindingSchema,
  action: z.enum(["pause", "resume", "interrupt"]),
});
export const avatarUserSubtitleSchema = z.object({ binding: avatarBindingSchema, text: z.string().check(z.minLength(1), z.maxLength(20_000)) });
export type AvatarUserSubtitleRequest = z.infer<typeof avatarUserSubtitleSchema>;
export type AvatarVoiceStateRequest = z.infer<typeof avatarVoiceStateSchema>;
export type AvatarPlaybackControlRequest = z.infer<typeof avatarPlaybackControlSchema>;

const identifier = z.string().check(z.minLength(1), z.maxLength(256));
export const avatarCapabilitiesSchema = z.object({
  actions: z
    .array(
      z.object({
        id: identifier,
        label: identifier,
        durationSeconds: z.optional(
          z.number().check(z.gte(0), z.lte(3_600)),
        ),
      }),
    )
    .check(z.maxLength(256)),
  expressions: z.array(identifier).check(z.maxLength(32)),
});
export type AvatarCapabilities = z.infer<typeof avatarCapabilitiesSchema>;
export const avatarReplySchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("startup-error"), error: z.string().check(z.minLength(1), z.maxLength(4000)) }),
  z.object({ type: z.literal("voice-command"), enabled: z.boolean() }),
  z.object({ type: z.literal("open-chat") }),
  z.object({ type: z.literal("playback"), runId: z.string(), active: z.boolean(),
    state: z.enum(["playing", "paused", "completed", "interrupted"]) }),
  z.object({
    type: z.literal("speech"),
    id: z.uuid(),
    status: z.enum(["started", "completed", "cancelled", "failed"]),
    error: z.optional(z.nullable(z.string())),
  }),
  z.object({ type: z.literal("dialogue-completed"), runId: z.uuid(), dialogueId: z.string() }),
  z.object({
    type: z.literal("action"),
    id: z.uuid(),
    status: z.enum(["started", "completed", "cancelled", "failed"]),
    error: z.optional(z.string()),
  }),
  z.object({
    type: z.literal("expression"),
    id: z.uuid(),
    status: z.enum(["applied", "failed"]),
    error: z.optional(z.string()),
  }),
  z.object({
    type: z.literal("ready"),
    capabilities: avatarCapabilitiesSchema,
  }),
  z.object({
    type: z.literal("result"),
    id: z.uuid(),
    ok: z.boolean(),
    error: z.optional(z.string()),
  }),
]);
export const AVATAR_CHANNELS = {
  start: "avatar:start",
  stop: "avatar:stop",
  status: "avatar:status",
  changed: "avatar:changed",
  voiceState: "avatar:voice-state",
  playbackControl: "avatar:playback-control",
  userSubtitle: "avatar:user-subtitle",
  openChat: "avatar:open-chat",
} as const;
