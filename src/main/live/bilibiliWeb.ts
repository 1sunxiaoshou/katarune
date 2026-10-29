import { createHash } from "node:crypto";
import protobuf from "protobufjs/light.js";
import { z } from "zod";
import { liveEventSchema, type LiveEvent } from "../../shared/live";
import { BiliAccessError, LiveOperationError } from "./errors";

const id = z.union([z.string().regex(/^\d+$/).max(32), z.number().int().safe().nonnegative()]).transform(String);
const stamp = z.union([z.number().finite().nonnegative(), z.string().regex(/^\d+$/).max(16).transform(Number)]);
const roomSchema = z.object({ room_id: id, uid: id, title: z.string().max(256), live_status: z.number().int(),
  description: z.string().transform(value => value.slice(0, 8000)).catch("").default(""),
  user_cover: z.string().max(2048).transform(value => {
    if (!value) return "";
    try { const url = new URL(value.startsWith("//") ? `https:${value}` : value); if (url.protocol !== "https:" && url.protocol !== "http:") return ""; url.protocol = "https:";
      return url.hostname.endsWith(".hdslb.com") && !url.port && !url.username && !url.password ? url.href : "";
    } catch { return ""; }
  }).catch("").default(""),
});
const senderSchema = z.object({ uid: id, base: z.object({ name: z.string().max(256) }) });
const giftSchema = z.object({
  giftId: id, giftName: z.string().min(1).max(256), num: z.number().int().min(1).max(1_000_000),
  uid: id, uname: z.string().max(256), timestamp: stamp,
  tid: z.string().max(256).optional(), sender_uinfo: senderSchema.optional(),
});
const allowedCookies = new Set(["SESSDATA", "buvid3", "buvid4", "bili_jct", "DedeUserID"]);
const WBI_ORDER = [46,47,18,2,53,8,23,32,15,50,10,31,58,3,45,35,27,43,5,49,33,9,42,19,29,28,14,39,12,38,41,13];
const MAX_RESPONSE = 2 * 1024 * 1024;

export function normalizeWebCookie(value: string): string {
  if (/[\r\n\x00-\x1f\x7f]/.test(value) || value.length > 16384) throw new LiveOperationError("网页 Cookie 格式无效。");
  const cookies = new Map<string, string>();
  for (const part of value.split(";")) {
    if (!part.trim()) continue;
    const index = part.indexOf("=");
    if (index < 1) throw new LiveOperationError("请填写 name=value 格式的 Cookie。");
    const name = part.slice(0, index).trim(), content = part.slice(index + 1).trim();
    if (allowedCookies.has(name) && content) cookies.set(name, content);
  }
  if (value.trim() && !cookies.size) throw new LiveOperationError("Cookie 中没有可用的 B 站登录或设备信息。");
  return [...cookies].map(([name, content]) => `${name}=${content}`).join("; ");
}

export function signBiliWeb(params: Record<string, string>, imgKey: string, subKey: string, now = Date.now()) {
  const source = imgKey + subKey;
  if (source.length < 64) throw new LiveOperationError("网页连接签名参数无效。");
  const mixin = WBI_ORDER.map(index => source[index]).join("");
  const values = { ...params, wts: String(Math.floor(now / 1000)) };
  const query = Object.entries(values).sort(([a], [b]) => a.localeCompare(b, "en")).map(([key, value]) =>
    `${encodeURIComponent(key)}=${encodeURIComponent(value.replace(/[!'()*]/g, ""))}`).join("&");
  return `${query}&w_rid=${createHash("md5").update(query + mixin).digest("hex")}`;
}

// Protocol field numbers: https://github.com/Akegarasu/blivedm-go/blob/master/pb/events.proto
// Decode only consumed fields; protobufjs skips unknown fields and preserves uint64 IDs as strings.
const proto = protobuf.Root.fromJSON({ nested: {
  User: { fields: { uid: { type: "uint64", id: 1 }, name: { type: "string", id: 2 } } },
  UserBase: { fields: { name: { type: "string", id: 1 } } },
  UserInfo: { fields: { uid: { type: "uint64", id: 1 }, base: { type: "UserBase", id: 2 } } },
  Danmaku: { fields: { id: { type: "string", id: 1 }, text: { type: "string", id: 6 }, timestamp: { type: "int64", id: 7 }, user: { type: "User", id: 20 } } },
  GiftItem: { fields: { giftId: { type: "uint32", id: 1 }, giftName: { type: "string", id: 2 }, num: { type: "uint32", id: 3 }, tid: { type: "string", id: 9 }, timestamp: { type: "uint64", id: 10 } } },
  Gifts: { fields: { uid: { type: "uint64", id: 1 }, uname: { type: "string", id: 2 }, gifts: { type: "GiftItem", id: 10, rule: "repeated" }, sender: { type: "UserInfo", id: 15 } } },
} });
function decode(type: "Danmaku" | "Gifts", value: string): unknown {
  if (value.length > MAX_RESPONSE || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw new Error("Invalid protobuf envelope");
  const message = proto.lookupType(type);
  return message.toObject(message.decode(Buffer.from(value, "base64")), { longs: String, defaults: true });
}
const milliseconds = (value: number) => value < 1e12 ? value * 1000 : value;
function event(roomId: string, kind: LiveEvent["kind"], source: unknown, fields: Partial<LiveEvent>): LiveEvent {
  return liveEventSchema.parse({ id: `web:${kind}:${createHash("sha256").update(JSON.stringify(source)).digest("hex")}`, roomId, kind,
    timestamp: Date.now(), userId: "", userName: "", text: "", giftId: "", giftName: "", quantity: 0, ...fields });
}

export function parseBiliWebEvents(value: unknown, roomId: string): LiveEvent[] {
  try {
    const envelope = z.object({ cmd: z.string().max(128), data: z.unknown().optional(), info: z.unknown().optional(), dm_v2: z.string().optional(), roomid: id.optional() }).parse(value);
    const command = envelope.cmd.split(":")[0];
    if (envelope.roomid && envelope.roomid !== roomId) return [];
    if (command === "DANMU_MSG") {
      if (envelope.dm_v2) {
        const data = z.object({ id: z.string().max(256), text: z.string().min(1).max(2000), timestamp: stamp, user: z.object({ uid: id, name: z.string().max(256) }) }).parse(decode("Danmaku", envelope.dm_v2));
        return [event(roomId, "danmaku", data.id || value, { userId: data.user.uid, userName: data.user.name, text: data.text, timestamp: milliseconds(data.timestamp) })];
      }
      const info = z.array(z.unknown()).min(3).max(64).parse(envelope.info);
      const meta = z.array(z.unknown()).min(5).max(64).parse(info[0]);
      const user = z.tuple([id, z.string().max(256)]).rest(z.unknown()).parse(info[2]);
      return [event(roomId, "danmaku", value, { userId: user[0], userName: user[1], text: z.string().min(1).max(2000).parse(info[1]), timestamp: milliseconds(stamp.parse(meta[4])) })];
    }
    if (command === "SEND_GIFT") {
      const data = giftSchema.parse(envelope.data);
      return [event(roomId, "gift", data.tid ? [data.tid, data.giftId] : value, { userId: data.sender_uinfo?.uid ?? data.uid, userName: data.sender_uinfo?.base.name ?? data.uname,
        giftId: data.giftId, giftName: data.giftName, quantity: data.num, timestamp: milliseconds(data.timestamp) })];
    }
    if (command === "SEND_GIFT_V2") {
      const wrapper = z.object({ pb: z.string().max(MAX_RESPONSE) }).parse(envelope.data);
      const data = z.object({ uid: id, uname: z.string().max(256), sender: senderSchema.nullish(), gifts: z.array(giftSchema.omit({ uid: true, uname: true, sender_uinfo: true })).max(1000) }).parse(decode("Gifts", wrapper.pb));
      return data.gifts.map((gift, index) => event(roomId, "gift", gift.tid ? [gift.tid, gift.giftId, index] : [value, index], { userId: data.sender?.uid ?? data.uid,
        userName: data.sender?.base.name ?? data.uname, giftId: gift.giftId, giftName: gift.giftName, quantity: gift.num, timestamp: milliseconds(gift.timestamp) }));
    }
    if (command === "LIVE" || command === "PREPARING") {
      const stateRoomId = envelope.roomid ?? z.object({ roomid: id }).parse(envelope.data).roomid;
      if (stateRoomId !== roomId) return [];
      return [event(roomId, command === "LIVE" ? "started" : "ended", value, {})];
    }
  } catch { /* Invalid or unsupported external events never become text or gifts. */ }
  return [];
}

export class BilibiliWebApi {
  private cookie: string;
  constructor(private readonly fetcher: typeof fetch, cookie: string, private readonly signal: AbortSignal) { this.cookie = normalizeWebCookie(cookie); }
  private async get(url: string): Promise<unknown> {
    const response = await this.fetcher(url, { redirect: "error", signal: AbortSignal.any([this.signal, AbortSignal.timeout(15_000)]), headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36",
      Referer: "https://live.bilibili.com/", ...(this.cookie ? { Cookie: this.cookie } : {}),
    } });
    if (response.status === 401 || response.status === 403 || response.status === 412) throw new BiliAccessError(`网页连接被拒绝（HTTP ${response.status}），请检查登录态或稍后重试。`);
    if (!response.ok) throw new LiveOperationError(`网页直播接口请求失败（HTTP ${response.status}）。`);
    const reader = response.body?.getReader(); if (!reader) throw new LiveOperationError("网页直播接口没有返回数据。");
    const chunks: Uint8Array[] = []; let size = 0;
    try { while (true) { const result = await reader.read(); if (result.done) break; size += result.value.byteLength; if (size > MAX_RESPONSE) { await reader.cancel(); throw new LiveOperationError("网页直播响应超过限制。"); } chunks.push(result.value); } }
    finally { reader.releaseLock(); }
    try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
    catch { throw new LiveOperationError("网页直播接口返回格式无效。"); }
  }
  private data(value: unknown): unknown {
    const result = z.object({ code: z.number().int(), data: z.unknown().optional() }).parse(value);
    if ([-101, -111, -352, 352, -403].includes(result.code)) throw new BiliAccessError(`网页登录态或访问校验失败（${result.code}），请更新 Cookie 或稍后重试。`);
    if (result.code !== 0) throw new LiveOperationError(`网页直播接口返回错误（${result.code}）。`);
    return result.data;
  }
  async room(roomId: string) { return roomSchema.parse(this.data(await this.get(`https://api.live.bilibili.com/room/v1/Room/get_info?room_id=${encodeURIComponent(roomId)}`))); }
  async prepare(roomId: string) {
    if (!/(?:^|;\s*)buvid3=/.test(this.cookie)) {
      const device = z.object({ b_3: z.string().min(1).max(256).regex(/^[A-Za-z0-9_-]+$/) }).parse(this.data(await this.get("https://api.bilibili.com/x/frontend/finger/spi")));
      this.cookie = [this.cookie, `buvid3=${device.b_3}`].filter(Boolean).join("; ");
    }
    const nav = z.object({ code: z.number().int(), data: z.object({ isLogin: z.boolean(), mid: id.optional(), wbi_img: z.object({ img_url: z.string().max(1024), sub_url: z.string().max(1024) }) }) }).parse(await this.get("https://api.bilibili.com/x/web-interface/nav"));
    if (/(?:^|;\s*)SESSDATA=/.test(this.cookie) && (!nav.data.isLogin || nav.code !== 0)) throw new BiliAccessError("B 站登录态已失效，请更新 Cookie。");
    if (nav.code !== 0 && nav.code !== -101) this.data(nav);
    const room = await this.room(roomId);
    const key = (url: string) => z.string().regex(/^[a-fA-F0-9]{32}$/).parse(new URL(url).pathname.split("/").at(-1)?.split(".")[0]);
    const query = signBiliWeb({ id: room.room_id, type: "0" }, key(nav.data.wbi_img.img_url), key(nav.data.wbi_img.sub_url));
    const hosts = z.object({ token: z.string().min(1).max(8192), host_list: z.array(z.object({ host: z.string().max(256).regex(/^[a-zA-Z0-9.-]+\.bilibili\.com$/), wss_port: z.number().int().min(1).max(65535) })).min(1).max(10) }).parse(this.data(await this.get(`https://api.live.bilibili.com/xlive/web-room/v1/index/getDanmuInfo?${query}`)));
    const uid = nav.data.isLogin ? Number(nav.data.mid) : 0;
    if (!Number.isSafeInteger(uid) || uid < 0 || !Number.isSafeInteger(Number(room.room_id))) throw new LiveOperationError("网页用户或房间标识无效。");
    const buvid = this.cookie.split(";").map(part => part.trim()).find(part => part.startsWith("buvid3="))?.slice(7);
    return { room, links: hosts.host_list.map(host => `wss://${host.host}:${host.wss_port}/sub`), auth: JSON.stringify({ uid, roomid: Number(room.room_id), protover: 3, platform: "web", type: 2, key: hosts.token, buvid }) };
  }
}
