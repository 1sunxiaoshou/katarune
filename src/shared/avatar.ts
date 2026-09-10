import * as z from "zod/mini";

export const avatarBindingSchema = z.object({
  characterId: z.uuid(),
  threadId: z.string().check(z.minLength(1)),
});
export type AvatarBinding = z.infer<typeof avatarBindingSchema>;
export const avatarStatusSchema = z.object({
  phase: z.enum(["stopped", "starting", "ready", "error"]),
  binding: z.nullable(avatarBindingSchema),
  error: z.nullable(z.string()),
});
export type AvatarStatus = z.infer<typeof avatarStatusSchema>;

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
} as const;
