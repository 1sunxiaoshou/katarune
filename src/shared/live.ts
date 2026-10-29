import * as z from "zod/mini";

const text = (max: number) => z.string().check(z.maxLength(max));
const integer = (min: number, max: number) => z.int().check(z.gte(min), z.lte(max));
export const LIVE_CHANNELS = { state: "live:state", settings: "live:settings", credentials: "live:credentials", webCredentials: "live:web-credentials", connect: "live:connect", disconnect: "live:disconnect", start: "live:start", stop: "live:stop", monitor: "live:monitor", changed: "live:changed", preview: "live:preview", subscribePreview: "live:subscribe-preview" } as const;
export const liveSettingsSchema = z.strictObject({
  connectionMode: z._default(z.enum(["official", "web"]), "official"),
  webRoomId: z._default(z.string().check(z.regex(/^(?:[1-9]\d{0,14})?$/)), ""),
  characterId: z.nullable(z.uuid()), instructions: text(8000), replyIntervalSeconds: integer(5, 300),
  proactive: z.boolean(), idleSeconds: integer(15, 1800), thankGifts: z.boolean(),
  background: z.enum(["immersive", "solid"]), backgroundColor: z.string().check(z.regex(/^#[0-9a-fA-F]{6}$/)),
  camera: z.enum(["overhead", "center", "closeup"]), subtitles: z.boolean(),
  voiceVolume: z.number().check(z.gte(0), z.lte(1)), musicVolume: z.number().check(z.gte(0), z.lte(1)),
  width: z.union([z.literal(1280), z.literal(1920), z.literal(2560)]), port: integer(1024, 65535),
});
export type LiveSettings = z.infer<typeof liveSettingsSchema>;
export const DEFAULT_LIVE_SETTINGS: LiveSettings = {
  connectionMode: "official", webRoomId: "",
  characterId: null, instructions: "", replyIntervalSeconds: 15, proactive: true, idleSeconds: 60,
  thankGifts: true, background: "immersive", backgroundColor: "#202020", camera: "center", subtitles: true,
  voiceVolume: 1, musicVolume: 1, width: 1920, port: 1935,
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
  id: text(256), kind: z.enum(["danmaku", "gift", "started", "ended", "interaction-ended"]),
  roomId: text(32), timestamp: z.number(), userId: text(256), userName: text(256),
  text: text(2000), giftId: text(64), giftName: text(256), quantity: integer(0, 1_000_000),
});
export type LiveEvent = z.infer<typeof liveEventSchema>;
export const liveRoomCoverSchema = z.string().check(z.maxLength(2048), z.refine(value => {
  if (!value) return true;
  try { const url = new URL(value); return url.protocol === "https:" && url.hostname.endsWith(".hdslb.com") && !url.port && !url.username && !url.password; }
  catch { return false; }
}));
export const liveStateSchema = z.strictObject({
  settings: liveSettingsSchema, credentialsConfigured: z.boolean(),
  officialCredentialsConfigured: z.boolean(), webCredentialsConfigured: z.boolean(),
  phase: z.enum(["stopped", "starting", "running", "stopping", "error"]),
  connection: z.enum(["disconnected", "connecting", "connected", "reconnecting", "error"]),
  broadcast: z.enum(["unknown", "offline", "live"]), roomId: text(32), roomName: text(256),
  roomCover: z._default(liveRoomCoverSchema, ""), roomDescription: z._default(text(8000), ""),
  threadId: z.nullable(text(128)), runId: z.nullable(z.uuid()), monitor: z.boolean(),
  generating: z.boolean(), revision: z.int(), events: z.array(liveEventSchema).check(z.maxLength(200)), error: z.nullable(text(1000)),
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
