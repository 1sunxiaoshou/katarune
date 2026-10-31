import { randomInt } from "node:crypto";
import { gunzipSync } from "node:zlib";
import protobuf from "protobufjs/light.js";
import WebSocket, { type RawData } from "ws";
import { z } from "zod";
import { liveEventSchema, livePlatformImageSchema, type LiveEvent } from "../../shared/live";
import type { BiliConnectionState } from "./bilibili";
import { LiveOperationError } from "./errors";
import { PlatformHttp, LIVE_WEB_UA } from "./platformHttp";
import { signDouyin, DOUYIN_SDK_VERSION } from "./douyinSignature";

const MAX_BYTES = 2 * 1024 * 1024;
const identifier = z.union([z.string().regex(/^\d+$/).max(32), z.number().int().safe().nonnegative()]).transform(String);
function roomCover(value: unknown): string {
  const image = z.object({ url_list: z.array(z.unknown()).max(10) }).safeParse(value);
  if (!image.success) return "";
  for (const candidate of image.data.url_list) {
    if (typeof candidate !== "string" || candidate.length > 2048) continue;
    try {
      const url = new URL(candidate.startsWith("//") ? `https:${candidate}` : candidate);
      if (url.protocol === "http:") url.protocol = "https:";
      const parsed = livePlatformImageSchema.safeParse(url.href);
      if (parsed.success) return parsed.data;
    } catch { /* Invalid optional cover metadata cannot prevent the room connection. */ }
  }
  return "";
}
const roomSchema = z.object({ id_str: identifier, title: z.string().max(256), status: z.number().int(), cover: z.unknown().optional().transform(roomCover) });
// Only consumed wire fields are declared. uint64 identities remain decimal strings.
// Protocol cross-reference: DouyinLiveWebFetcher/douyin.proto and dyhub's webcast decoder.
const schema = protobuf.Root.fromJSON({ nested: {
  Header: { fields: { key: { type: "string", id: 1 }, value: { type: "string", id: 2 } } },
  Frame: { fields: { logId: { type: "uint64", id: 2 }, headers: { type: "Header", id: 5, rule: "repeated" }, encoding: { type: "string", id: 6 }, type: { type: "string", id: 7 }, payload: { type: "bytes", id: 8 } } },
  Batch: { fields: { messages: { type: "Message", id: 1, rule: "repeated" }, internalExt: { type: "string", id: 5 }, needAck: { type: "bool", id: 9 } } },
  Message: { fields: { method: { type: "string", id: 1 }, payload: { type: "bytes", id: 2 }, id: { type: "uint64", id: 3 } } },
  Common: { fields: { id: { type: "uint64", id: 2 }, roomId: { type: "uint64", id: 3 }, time: { type: "uint64", id: 4 } } },
  User: { fields: { id: { type: "uint64", id: 1 }, name: { type: "string", id: 3 } } },
  Chat: { fields: { common: { type: "Common", id: 1 }, user: { type: "User", id: 2 }, text: { type: "string", id: 3 } } },
  GiftInfo: { fields: { id: { type: "uint64", id: 5 }, combo: { type: "bool", id: 10 }, name: { type: "string", id: 16 } } },
  Gift: { fields: { common: { type: "Common", id: 1 }, giftId: { type: "uint64", id: 2 }, repeat: { type: "uint64", id: 5 }, user: { type: "User", id: 7 }, end: { type: "uint32", id: 9 }, groupId: { type: "uint64", id: 11 }, gift: { type: "GiftInfo", id: 15 } } },
  Control: { fields: { common: { type: "Common", id: 1 }, status: { type: "uint32", id: 2 } } },
} });
export function decodeDouyin(type: string, bytes: Uint8Array): unknown {
  if (bytes.length > MAX_BYTES) throw new Error("Webcast packet too large");
  const model = schema.lookupType(type);
  return model.toObject(model.decode(bytes), { longs: String, defaults: true });
}
const messageSchema = z.object({ method: z.string().max(128), payload: z.instanceof(Uint8Array), id: identifier });
export function decodeDouyinFrame(bytes: Uint8Array) {
  const frame = z.object({ logId: identifier, headers: z.array(z.object({ key: z.string(), value: z.string() })).max(100), encoding: z.string(), type: z.string(), payload: z.instanceof(Uint8Array) }).parse(decodeDouyin("Frame", bytes));
  if (!frame.payload.length) throw new Error("Missing webcast payload");
  let payload = Buffer.from(frame.payload);
  if (frame.encoding === "gzip" || frame.headers.some(header => header.key === "compress_type" && header.value === "gzip") || (payload[0] === 31 && payload[1] === 139)) {
    payload = gunzipSync(payload, { maxOutputLength: MAX_BYTES });
  }
  const batch = z.object({ messages: z.array(messageSchema).max(1000), needAck: z.boolean(), internalExt: z.string().max(16384) }).parse(decodeDouyin("Batch", payload));
  const ack = batch.needAck ? schema.lookupType("Frame").encode({ logId: frame.logId, type: "ack", payload: Buffer.from(batch.internalExt) }).finish() : null;
  return { messages: batch.messages, ack };
}
const userSchema = z.object({ id: identifier, name: z.string().max(256) });
const commonSchema = z.object({ id: identifier, roomId: identifier, time: identifier });
export function parseDouyinEvent(message: z.infer<typeof messageSchema>, roomId: string): LiveEvent | null {
  const common = { platform: "douyin" as const, userIdKind: "uid" as const, roomId, userId: "", userName: "", text: "", giftId: "", giftName: "", quantity: 0 };
  try {
    if (message.method === "WebcastChatMessage") {
      const data = z.object({ common: commonSchema, user: userSchema, text: z.string().min(1).max(2000) }).parse(decodeDouyin("Chat", message.payload));
      if (data.common.roomId !== roomId || (data.common.id === "0" && message.id === "0")) return null;
      return liveEventSchema.parse({ ...common, id: `douyin:chat:${(data.common.id !== "0" ? data.common.id : message.id)}`, kind: "danmaku", timestamp: Number(data.common.time) * 1000, userId: data.user.id === "0" ? "" : data.user.id, userName: data.user.name, text: data.text });
    }
    if (message.method === "WebcastGiftMessage") {
      const data = z.object({ common: commonSchema, user: userSchema, giftId: identifier, repeat: identifier, groupId: identifier, gift: z.object({ name: z.string().min(1).max(256) }) }).parse(decodeDouyin("Gift", message.payload));
      if (data.common.roomId !== roomId || (data.common.id === "0" && message.id === "0")) return null;
      return liveEventSchema.parse({ ...common, id: `douyin:gift:${(data.common.id !== "0" ? data.common.id : message.id)}`, kind: "gift", timestamp: Number(data.common.time) * 1000, userId: data.user.id === "0" ? "" : data.user.id, userName: data.user.name, giftId: data.giftId, giftName: data.gift.name, quantity: Number(data.repeat) });
    }
    if (message.method === "WebcastControlMessage") {
      const data = z.object({ common: commonSchema, status: z.number().int() }).parse(decodeDouyin("Control", message.payload));
      if (data.common.roomId !== roomId || data.status !== 3) return null;
      return liveEventSchema.parse({ ...common, id: `douyin:end:${data.common.id}`, kind: "ended", timestamp: Number(data.common.time) * 1000 });
    }
  } catch { /* External invalid payloads cannot become viewer or payment events. */ }
  return null;
}

export class DouyinConnection {
  onState: (state: BiliConnectionState) => void = () => {};
  onEvent: (event: LiveEvent) => void = () => {};
  onFailure: (error: Error) => void = () => {};
  private state: BiliConnectionState = { connection: "disconnected", broadcast: "unknown", roomId: "", roomName: "", roomCover: "", roomDescription: "" };
  private socket: WebSocket | undefined;
  private controller: AbortController | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;
  private roomTimer: ReturnType<typeof setTimeout> | undefined;
  private retry: ReturnType<typeof setTimeout> | undefined;
  private revision = 0;
  private seen = new Set<string>();
  private combos = new Map<string, number>();
  constructor(private readonly fetcher: typeof fetch = fetch, private readonly socketFactory = (url: string, cookie: string) => new WebSocket(url, { headers: { Cookie: cookie, "User-Agent": LIVE_WEB_UA, Origin: "https://live.douyin.com", Referer: "https://live.douyin.com/" }, maxPayload: MAX_BYTES, perMessageDeflate: false })) {}
  private change(patch: Partial<BiliConnectionState>) { this.state = { ...this.state, ...patch }; this.onState({ ...this.state }); }
  async connectWeb({ roomId, cookie }: { roomId: string; cookie: string }, signal?: AbortSignal) {
    await this.disconnect(); this.seen.clear(); this.combos.clear();
    const revision = ++this.revision, controller = new AbortController(); this.controller = controller;
    const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    const http = new PlatformHttp("douyin.com", this.fetcher); http.importCookie(cookie, "https://live.douyin.com/");
    this.change({ connection: "connecting", broadcast: "unknown" });
    let failures = 0;
    let endedRoomId = "";
    const broadcast = (room: z.infer<typeof roomSchema>) => room.id_str === endedRoomId ? "offline" : room.status === 2 ? "live" : room.status === 4 ? "offline" : "unknown";
    const reconnect = () => {
      if (combined.aborted || revision !== this.revision) return;
      this.change({ connection: "reconnecting", broadcast: "unknown" });
      if (failures >= 7) {
        this.change({ connection: "error" });
        this.onFailure(new LiveOperationError("抖音弹幕重连失败，请重新连接。"));
        return;
      }
      const delay = Math.min(30000, 1000 * 2 ** failures++);
      this.retry = setTimeout(() => { void open().catch(reconnect); }, delay);
      this.retry.unref();
    };
    const open = async (): Promise<void> => {
      combined.throwIfAborted();
      if (!http.jar.getCookiesSync('https://live.douyin.com/').some(cookie => cookie.key === 'ttwid')) await http.request('https://live.douyin.com/', combined);
      const room = await this.room(http, roomId, combined); combined.throwIfAborted();
      if (revision !== this.revision) return;
      this.change({ roomId: room.id_str, roomName: room.title, roomCover: room.cover, broadcast: "unknown" });
      const deviceId = String(7300000000000000000n + BigInt(randomInt(0, 1_000_000_000)));
      const params = new URLSearchParams({ app_name: "douyin_web", room_id: room.id_str, compress: "gzip", version_code: "180800", webcast_sdk_version: DOUYIN_SDK_VERSION,
        update_version_code: DOUYIN_SDK_VERSION, live_id: "1", did_rule: "3", user_unique_id: deviceId, device_platform: "web", identity: "audience", aid: "6383", endpoint: "live_pc",
        browser_name: "Mozilla", browser_version: LIVE_WEB_UA.slice("Mozilla/".length), browser_platform: "Win32", browser_language: "zh-CN", browser_online: "true", cookie_enabled: "true", screen_width: "1920", screen_height: "1080", tz_name: "Asia/Shanghai", support_wrds: "1", im_path: "/webcast/im/fetch/", heartbeatDuration: "0", signature: signDouyin(room.id_str, deviceId) });
      const ws = this.socketFactory(`wss://webcast100-ws-web-lq.douyin.com/webcast/im/push/v2/?${params}`, http.cookie("https://live.douyin.com/")); this.socket = ws;
      await new Promise<void>((resolve, reject) => {
        let ready = false, settled = false, lastFrame = Date.now(), roomCheckPending = false, roomCheckFailures = 0, broadcastRevision = 0;
        const currentSocket = () => !combined.aborted && revision === this.revision && this.socket === ws && ws.readyState === WebSocket.OPEN;
        const scheduleRoomCheck = () => {
          if (!ready || !currentSocket()) return;
          if (this.roomTimer) clearTimeout(this.roomTimer);
          const delay = roomCheckFailures ? Math.min(30000, 3000 * 2 ** Math.min(roomCheckFailures, 4)) : this.state.broadcast === "live" ? 10000 : 3000;
          this.roomTimer = setTimeout(() => { void refreshRoom(); }, delay);
          this.roomTimer.unref();
        };
        const refreshRoom = async () => {
          if (!ready || roomCheckPending || !currentSocket()) return;
          roomCheckPending = true;
          const expected = broadcastRevision;
          try {
            const current = await this.room(http, roomId, combined);
            if (!currentSocket() || expected !== broadcastRevision) return;
            if (current.id_str !== room.id_str) { ws.close(); return; }
            roomCheckFailures = 0;
            this.change({ roomName: current.title, ...(current.cover ? { roomCover: current.cover } : {}), broadcast: broadcast(current) });
          } catch {
            if (currentSocket() && expected === broadcastRevision) {
              roomCheckFailures++;
              this.change({ broadcast: room.id_str === endedRoomId ? "offline" : "unknown" });
            }
          } finally { roomCheckPending = false; scheduleRoomCheck(); }
        };
        const fail = () => { if (!settled) { settled = true; clearTimeout(timeout); reject(new LiveOperationError("抖音弹幕连接未通过验证，请检查登录态或稍后重试。")); } ws.close(); };
        const timeout = setTimeout(fail, 15000);
        const cancel = () => { fail(); ws.terminate(); };
        combined.addEventListener("abort", cancel, { once: true });
        ws.on("open", () => {
          if (combined.aborted || revision !== this.revision) { cancel(); return; }
          if (this.timer) clearInterval(this.timer);
          this.timer = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN && Date.now() - lastFrame < 45000) {
              ws.send(Buffer.from([0x3a, 2, 0x68, 0x62]));
            } else ws.close();
          }, 10000);
          this.timer.unref();
        });
        ws.on("message", (data: RawData, binary) => {
          if (!binary || combined.aborted || revision !== this.revision || this.socket !== ws) return;
          try {
            const bytes = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data instanceof ArrayBuffer ? new Uint8Array(data) : data);
            const decoded = decodeDouyinFrame(bytes); lastFrame = Date.now();
            if (decoded.ack) ws.send(decoded.ack);
            if (!ready) {
              ready = true; settled = true; failures = 0; clearTimeout(timeout);
              this.change({ connection: "connected", broadcast: broadcast(room) }); resolve();
              void refreshRoom();
            }
            for (const message of decoded.messages) {
              const event = parseDouyinEvent(message, room.id_str);
              if (!event || this.seen.has(event.id)) continue;
              this.seen.add(event.id); while (this.seen.size > 4000) this.seen.delete(this.seen.values().next().value!);
              if (event.kind === "gift") {
                const info = z.object({ groupId: identifier, gift: z.object({ combo: z.boolean() }) }).parse(decodeDouyin("Gift", message.payload));
                if (info.gift.combo && info.groupId !== "0") {
                  const key = `${event.userId}:${event.giftId}:${info.groupId}`, previous = this.combos.get(key) ?? 0;
                  this.combos.set(key, Math.max(previous, event.quantity)); event.quantity = Math.max(0, event.quantity - previous);
                  while (this.combos.size > 1000) this.combos.delete(this.combos.keys().next().value!);
                  if (!event.quantity) continue;
                }
              }
              if (event.kind === "ended") { ++broadcastRevision; endedRoomId = room.id_str; roomCheckFailures = 0; this.change({ broadcast: "offline" }); scheduleRoomCheck(); }
              this.onEvent(event);
            }
          } catch { /* Ignore malformed frames within the configured size bounds. */ }
        });
        ws.on("error", fail);
        ws.on("close", () => {
          clearTimeout(timeout); combined.removeEventListener("abort", cancel);
          if (this.socket !== ws || combined.aborted || revision !== this.revision) return;
          if (this.timer) clearInterval(this.timer);
          if (this.roomTimer) clearTimeout(this.roomTimer);
          if (!ready) { fail(); return; }
          reconnect();
        });
      });
    };
    try { await open(); combined.throwIfAborted(); }
    catch (error) { await this.disconnect(); this.change({ connection: "error" }); throw error; }
  }
  private async room(http: PlatformHttp, roomId: string, signal: AbortSignal) {
    const query = new URLSearchParams({ aid: "6383", app_name: "douyin_web", live_id: "1", device_platform: "web", web_rid: roomId });
    const result = z.object({ status_code: z.literal(0), data: z.object({ data: z.array(roomSchema).min(1).max(10) }) }).safeParse(await http.json(`https://live.douyin.com/webcast/room/web/enter/?${query}`, signal));
    if (!result.success) throw new LiveOperationError("未取得抖音直播间信息，请检查房间号、登录态或平台验证。");
    return result.data.data.data[0]!;
  }
  cancelPending() {
    ++this.revision; this.controller?.abort();
    if (this.timer) clearInterval(this.timer); if (this.retry) clearTimeout(this.retry);
    if (this.roomTimer) clearTimeout(this.roomTimer); this.roomTimer = undefined;
    const socket = this.socket; this.socket = undefined; socket?.terminate();
  }
  async disconnect() { this.cancelPending(); this.change({ connection: "disconnected", broadcast: "unknown", roomId: "", roomName: "", roomCover: "", roomDescription: "" }); }
}
