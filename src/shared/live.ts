import * as z from "zod/mini";
import { avatarCameraViewSchema } from "./avatarCamera";
import { avatarBackgroundSchema, DEFAULT_AVATAR_BACKGROUND } from "./avatarBackground";

const text = (max: number) => z.string().check(z.maxLength(max));
const integer = (min: number, max: number) => z.int().check(z.gte(min), z.lte(max));
export const livePlatformSchema = z.enum(["bilibili", "douyin"]);
export type LivePlatform = z.infer<typeof livePlatformSchema>;
export const livePlatformImageSchema = z.string().check(z.maxLength(2048), z.refine(value => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.port && !url.username && !url.password &&
      ["hdslb.com", "douyinpic.com"].some(domain => url.hostname.endsWith(`.${domain}`));
  } catch { return false; }
}));
export const liveAccountSchema = z.strictObject({ platform: livePlatformSchema, id: text(256), name: text(256), avatarUrl: z.optional(livePlatformImageSchema) });
export type LiveAccount = z.infer<typeof liveAccountSchema>;
export const LIVE_CHANNELS = { state: "live:state", settings: "live:settings", credentials: "live:credentials", webCredentials: "live:web-credentials", connect: "live:connect", disconnect: "live:disconnect", start: "live:start", stop: "live:stop", monitor: "live:monitor", changed: "live:changed", preview: "live:preview", subscribePreview: "live:subscribe-preview" } as const;
export const liveSettingsSchema = z.strictObject({
  platform: z._default(livePlatformSchema, "bilibili"),
  connectionMode: z._default(z.enum(["official", "web"]), "official"),
  webRoomId: z._default(z.string().check(z.regex(/^(?:[1-9]\d{0,19})?$/)), ""),
  characterId: z.nullable(z.uuid()), instructions: text(8000), replyIntervalSeconds: integer(5, 300),
  proactive: z.boolean(), idleSeconds: integer(15, 1800), thankGifts: z.boolean(),
  camera: avatarCameraViewSchema, subtitles: z.boolean(),
  backgroundId: z._default(avatarBackgroundSchema, DEFAULT_AVATAR_BACKGROUND),
  voiceVolume: z.number().check(z.gte(0), z.lte(1)), musicVolume: z.number().check(z.gte(0), z.lte(1)),
  aspectRatio: z._default(z.enum(["16:9", "9:16"]), "16:9"),
  width: z.union([z.literal(1280), z.literal(1920), z.literal(2560)]), port: integer(1024, 65535),
});
export type LiveSettings = z.infer<typeof liveSettingsSchema>;
// The stored width selects the resolution's long edge in either orientation.
export function liveOutputDimensions(settings: Pick<LiveSettings, "width" | "aspectRatio">) {
  const shortEdge = settings.width * 9 / 16;
  return settings.aspectRatio === "9:16" ? { width: shortEdge, height: settings.width } : { width: settings.width, height: shortEdge };
}
export const DEFAULT_LIVE_SETTINGS: LiveSettings = {
  platform: "bilibili",
  connectionMode: "official", webRoomId: "",
  characterId: null, instructions: "", replyIntervalSeconds: 15, proactive: true, idleSeconds: 60,
  thankGifts: true, camera: "center", subtitles: true,
  backgroundId: DEFAULT_AVATAR_BACKGROUND,
  voiceVolume: 1, musicVolume: 1, aspectRatio: "16:9", width: 1920, port: 1935,
};
export const liveCredentialsSchema = z.strictObject({
  appId: z.string().check(z.refine(value => /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n)),
  accessKey: z.string().check(z.minLength(1), z.maxLength(256)),
  accessSecret: z.string().check(z.minLength(1), z.maxLength(512)),
  identityCode: z.string().check(z.minLength(1), z.maxLength(256)),
});
export type LiveCredentials = z.infer<typeof liveCredentialsSchema>;
export const liveWebCredentialsSchema = z.strictObject({
  cookie: z.string().check(z.maxLength(16384), z.regex(/^[^\r\n\x00-\x1f\x7f]*$/)),
});
export type LiveWebCredentials = z.infer<typeof liveWebCredentialsSchema>;
export const liveEventSchema = z.strictObject({
  platform: z.optional(livePlatformSchema),
  userIdKind: z.optional(z.enum(["uid", "open_id"])),
  id: text(256), kind: z.enum(["danmaku", "gift", "started", "ended", "interaction-ended"]),
  roomId: text(32), timestamp: z.number(), userId: text(256), userName: text(256),
  text: text(2000), giftId: text(64), giftName: text(256), quantity: integer(0, 1_000_000),
});
export type LiveEvent = z.infer<typeof liveEventSchema>;
export const liveRoomCoverSchema = z.union([z.literal(""), livePlatformImageSchema]);
export const liveStateSchema = z.strictObject({
  accounts: z.optional(z.array(liveAccountSchema).check(z.maxLength(2))),
  settings: liveSettingsSchema, credentialsConfigured: z.boolean(),
  officialCredentialsConfigured: z.boolean(), webCredentialsConfigured: z.boolean(),
  phase: z.enum(["stopped", "starting", "running", "stopping", "error"]),
  connection: z.enum(["disconnected", "connecting", "waiting", "connected", "reconnecting", "error"]),
  broadcast: z.enum(["unknown", "offline", "live"]), roomId: text(32), roomName: text(256),
  roomCover: z._default(liveRoomCoverSchema, ""), roomDescription: z._default(text(8000), ""),
  threadId: z.nullable(text(128)), runId: z.nullable(z.uuid()), monitor: z.boolean(),
  generating: z.boolean(), revision: z.int(), events: z.array(liveEventSchema).check(z.maxLength(200)), error: z.nullable(text(1000)),
  errorCode: z._default(z.nullable(z.literal("port-in-use")), null),
});
export type LiveState = z.infer<typeof liveStateSchema>;
export const liveMonitorSchema = z.strictObject({ enabled: z.boolean() });
export const MAX_LIVE_PREVIEW_BYTES = 16 * 1024 * 1024;
export const LIVE_PREVIEW_MIME = 'video/mp4; codecs="avc1.640033,mp4a.40.2"';
export const livePreviewSchema = z.strictObject({
  initialization: z.instanceof(Uint8Array).check(z.refine(v => v.byteLength > 0 && v.byteLength <= 1024 * 1024)),
  fragment: z.instanceof(Uint8Array).check(z.refine(v => v.byteLength > 0 && v.byteLength <= MAX_LIVE_PREVIEW_BYTES)),
  sequence: z.int().check(z.gte(0)),
});
export type LivePreview = z.infer<typeof livePreviewSchema>;
export interface LiveApi {
  startLiveLogin(platform: LivePlatform): Promise<LiveLoginState>;
  pollLiveLogin(id: string): Promise<LiveLoginState>;
  cancelLiveLogin(id: string): Promise<void>;
  showLiveLoginVerification(id: string): Promise<void>;
  logoutLiveAccount(platform: LivePlatform): Promise<LiveState>;
  getLiveState(): Promise<LiveState>;
  updateLiveSettings(settings: LiveSettings): Promise<LiveState>;
  setLiveCredentials(credentials: LiveCredentials): Promise<LiveState>;
  setLiveWebCredentials(credentials: LiveWebCredentials): Promise<LiveState>;
  connectLiveRoom(): Promise<LiveState>;
  disconnectLiveRoom(): Promise<LiveState>;
  startLive(): Promise<LiveState>;
  stopLive(): Promise<LiveState>;
  setLiveMonitor(request: { enabled: boolean }): Promise<LiveState>;
  onLiveChanged(listener: (state: LiveState) => void): () => void;
  onLivePreview(listener: (frame: LivePreview) => void | Promise<void>): () => void;
}

export const liveLoginIdSchema = z.uuid();
export const liveLoginStateSchema = z.strictObject({
  id: liveLoginIdSchema, platform: livePlatformSchema,
  status: z.enum(["waiting", "scanned", "verification", "completed", "expired", "error", "cancelled"]),
  qrImage: z.string().check(z.maxLength(200000), z.regex(/^(?:data:image\/png;base64,[A-Za-z0-9+/=]+)?$/)),
  expiresAt: z.number(), account: z.nullable(liveAccountSchema), message: text(500),
});
export type LiveLoginState = z.infer<typeof liveLoginStateSchema>;
export const LIVE_LOGIN_CHANNELS = { start: "live:login:start", poll: "live:login:poll", cancel: "live:login:cancel", logout: "live:login:logout", verification: "live:login:verification" } as const;
