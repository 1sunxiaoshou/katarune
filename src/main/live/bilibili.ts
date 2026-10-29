import { createHash, createHmac, randomUUID } from "node:crypto";
import { brotliDecompressSync, inflateSync } from "node:zlib";
import { z } from "zod";
import type { LiveCredentials, LiveEvent, LiveState } from "../../shared/live";
import { BiliAccessError, LiveOperationError } from "./errors";
import { BilibiliWebApi, parseBiliWebEvents } from "./bilibiliWeb";
import { diagnostic } from "../diagnostics/logger";

const BASE = "https://live-open.biliapi.com";
const MAX_PACKET = 2 * 1024 * 1024;
const accessErrors = new Set([4000,4001,4002,4003,4005,4006,4007,4008,4010,4011,4012,4013,5004,5005,5011,7007,8002]);
const identifier = z.union([z.string().min(1).max(32).regex(/^\d+$/), z.number().int().safe().nonnegative()]).transform(String);
const startSchema = z.object({ data: z.object({
  game_info: z.object({ game_id: z.string().min(1).max(256) }),
  anchor_info: z.object({ room_id: identifier, uname: z.string().max(256) }),
  websocket_info: z.object({ auth_body: z.string().max(8192), wss_link: z.array(z.url()).min(1).max(10) }),
}) });
const payloadSchema = z.object({ cmd: z.string(), data: z.object({
  room_id: identifier.optional(), msg_id: z.string().max(256).optional(), timestamp: z.number().finite().optional(),
  open_id: z.string().max(256).optional(), uname: z.string().max(256).optional(), msg: z.string().max(2000).optional(),
  gift_id: identifier.optional(), gift_name: z.string().max(256).optional(), gift_num: z.number().int().min(0).max(1_000_000).optional(),
  game_id: z.string().max(256).optional(),
}).passthrough() });

export function biliHeaders(body: string, credentials: LiveCredentials, now = Date.now(), nonce: string = randomUUID()) {
  const headers: Record<string, string> = {
    "x-bili-accesskeyid": credentials.accessKey,
    "x-bili-content-md5": createHash("md5").update(body).digest("hex"),
    "x-bili-signature-method": "HMAC-SHA256", "x-bili-signature-nonce": nonce,
    "x-bili-signature-version": "1.0", "x-bili-timestamp": String(Math.floor(now / 1000)),
  };
  const canonical = Object.keys(headers).sort().map(key => `${key}:${headers[key]}`).join("\n");
  return { ...headers, Authorization: createHmac("sha256", credentials.accessSecret).update(canonical).digest("hex"), "Content-Type": "application/json", Accept: "application/json" };
}

export function biliPacket(operation: number, body: string) {
  const bytes = Buffer.from(body), packet = Buffer.alloc(16 + bytes.length);
  packet.writeUInt32BE(packet.length, 0); packet.writeUInt16BE(16, 4); packet.writeUInt16BE(1, 6);
  packet.writeUInt32BE(operation, 8); packet.writeUInt32BE(1, 12); bytes.copy(packet, 16);
  return packet;
}

export function decodeBiliPackets(bytes: Buffer, depth = 0): { operation: number; body: unknown }[] {
  if (bytes.length > MAX_PACKET || depth > 3) throw new Error("官方消息包超过限制。");
  const output: { operation: number; body: unknown }[] = [];
  for (let offset = 0; offset < bytes.length;) {
    if (bytes.length - offset < 16) throw new Error("官方消息包不完整。");
    const length = bytes.readUInt32BE(offset), header = bytes.readUInt16BE(offset + 4);
    const version = bytes.readUInt16BE(offset + 6), operation = bytes.readUInt32BE(offset + 8);
    if (length < header || header < 16 || length > MAX_PACKET || offset + length > bytes.length) throw new Error("官方消息包结构无效。");
    const body = bytes.subarray(offset + header, offset + length); offset += length;
    if (version === 2 || version === 3) {
      const decoded = version === 2 ? inflateSync(body, { maxOutputLength: MAX_PACKET }) : brotliDecompressSync(body, { maxOutputLength: MAX_PACKET });
      output.push(...decodeBiliPackets(decoded, depth + 1));
    } else if (operation === 3) {
      output.push({ operation, body: null });
    } else if (operation === 5 || operation === 8) {
      output.push({ operation, body: JSON.parse(body.toString("utf8")) });
    }
    if (output.length > 1000) throw new Error("官方消息数量超过限制。");
  }
  return output;
}

export function parseBiliEvent(value: unknown, roomId: string, gameId: string): LiveEvent | null {
  const parsed = payloadSchema.safeParse(value);
  if (!parsed.success) return null;
  const { cmd, data } = parsed.data;
  const kinds: Record<string, LiveEvent["kind"]> = {
    LIVE_OPEN_PLATFORM_DM: "danmaku", LIVE_OPEN_PLATFORM_SEND_GIFT: "gift",
    LIVE_OPEN_PLATFORM_LIVE_START: "started", LIVE_OPEN_PLATFORM_LIVE_END: "ended",
    LIVE_OPEN_PLATFORM_INTERACTION_END: "interaction-ended",
  };
  const kind = kinds[cmd];
  if (!kind || (kind === "interaction-ended" ? data.game_id !== gameId : data.room_id !== roomId)) return null;
  if (kind === "danmaku" && !data.msg) return null;
  if (kind === "gift" && (!data.gift_id || !data.gift_name || !data.gift_num || !data.msg_id)) return null;
  const timestamp = data.timestamp ?? Date.now() / 1000;
  return {
    id: data.msg_id ?? createHash("sha256").update(JSON.stringify(parsed.data)).digest("hex"),
    kind, roomId, timestamp: timestamp < 1e12 ? timestamp * 1000 : timestamp,
    userId: data.open_id ?? "", userName: data.uname ?? "", text: data.msg ?? "",
    giftId: data.gift_id ?? "", giftName: data.gift_name ?? "", quantity: data.gift_num ?? 0,
  };
}

export type BiliConnectionState = Pick<LiveState, "connection" | "broadcast" | "roomId" | "roomName" | "roomCover" | "roomDescription">;
export class BilibiliConnection {
  private socket: WebSocket | undefined;
  private credentials: LiveCredentials | undefined;
  private web: BilibiliWebApi | undefined;
  private webRoomId = "";
  private broadcastRevision = 0;
  private gameId = "";
  private epoch = 0;
  private timer?: ReturnType<typeof setInterval>;
  private retry?: ReturnType<typeof setTimeout>;
  private retryCount = 0;
  private requests: AbortController | undefined;
  private connecting: Promise<void> | undefined;
  private rejectSocket: ((error: Error) => void) | undefined;
  private seen = new Map<string, number>();
  private state: BiliConnectionState = { connection: "disconnected", broadcast: "unknown", roomId: "", roomName: "", roomCover: "", roomDescription: "" };
  onState: (state: BiliConnectionState) => void = () => {};
  onEvent: (event: LiveEvent) => void = () => {};
  onFailure: (error: Error) => void = () => {};
  constructor(private readonly fetcher: typeof fetch = fetch, private readonly socketFactory: (url: string) => WebSocket = url => new WebSocket(url)) {}
  get status() { return { ...this.state }; }
  private change(next: Partial<BiliConnectionState>) { this.state = { ...this.state, ...next }; this.onState(this.status); }
  private async api(path: string, body: string, credentials = this.credentials) {
    if (!credentials) throw new Error("尚未配置官方直播凭据。");
    const signal = path === "/v2/app/end" ? AbortSignal.timeout(3000)
      : AbortSignal.any([this.requests?.signal ?? new AbortController().signal, AbortSignal.timeout(15_000)]);
    const response = await this.fetcher(`${BASE}${path}`, { method: "POST", headers: biliHeaders(body, credentials), body, signal });
    if (response.status === 401 || response.status === 403) throw new BiliAccessError(`官方直播接口拒绝访问（HTTP ${response.status}），请检查凭据与权限。`);
    if (!response.ok) throw new LiveOperationError(`官方直播接口请求失败（HTTP ${response.status}）。`);
    const value: unknown = await response.json();
    const result = z.object({ code: z.number().int() }).parse(value);
    if (accessErrors.has(result.code)) throw new BiliAccessError(`官方直播配置或权限不可用（${result.code}），请检查项目、身份码及开发者配置。`);
    if (result.code !== 0) throw new LiveOperationError(`官方直播接口返回错误（${result.code}）。`);
    return value;
  }
  async connect(credentials: LiveCredentials, signal?: AbortSignal) {
    return this.connectSource({ kind: "official", credentials }, signal);
  }
  async connectWeb(credentials: { roomId: string; cookie: string }, signal?: AbortSignal) {
    return this.connectSource({ kind: "web", ...credentials }, signal);
  }
  private async connectSource(source: { kind: "official"; credentials: LiveCredentials } | { kind: "web"; roomId: string; cookie: string }, signal?: AbortSignal) {
    if (this.connecting) return this.connecting;
    this.connecting = this.beginConnect(source, signal);
    try { await this.connecting; } finally { this.connecting = undefined; }
  }
  private async beginConnect(source: { kind: "official"; credentials: LiveCredentials } | { kind: "web"; roomId: string; cookie: string }, signal?: AbortSignal) {
    await this.disconnect();
    signal?.throwIfAborted();
    const epoch = ++this.epoch; this.retryCount = 0;
    this.seen.clear();
    this.requests = new AbortController();
    if (source.kind === "official") this.credentials = source.credentials;
    else { this.web = new BilibiliWebApi(this.fetcher, source.cookie, this.requests.signal); this.webRoomId = source.roomId; }
    const cancel = () => this.cancelPending();
    signal?.addEventListener("abort", cancel, { once: true });
    this.change({ connection: "connecting", broadcast: "unknown" });
    try { await this.open(epoch); if (epoch !== this.epoch) throw new Error("连接已取消。"); }
    catch (error) { if (epoch === this.epoch) { await this.disconnect(); this.change({ connection: "error" }); } throw error; }
    finally { signal?.removeEventListener("abort", cancel); }
  }
  private async open(epoch: number) {
    if (this.web) { await this.openWeb(epoch); return; }
    const credentials = this.credentials;
    if (!credentials || epoch !== this.epoch) return;
    const started = startSchema.parse(await this.api("/v2/app/start", `{"app_id":${credentials.appId},"code":${JSON.stringify(credentials.identityCode)}}`, credentials)).data;
    if (epoch !== this.epoch) { await this.end(started.game_info.game_id, credentials); return; }
    this.gameId = started.game_info.game_id;
    this.change({ roomId: started.anchor_info.room_id, roomName: "", roomCover: "", roomDescription: "", broadcast: "unknown" });
    // Public presentation metadata cannot confirm official broadcast state.
    void this.refreshOfficialRoom(started.anchor_info.room_id, epoch);
    let lastError: unknown;
    for (const link of started.websocket_info.wss_link) {
      const url = new URL(link);
      if (url.protocol !== "wss:" || !(url.hostname.endsWith(".bilibili.com") || url.hostname.endsWith(".biliapi.com"))) continue;
      try { await this.attach(link, started.websocket_info.auth_body, epoch); return; }
      catch (error) { lastError = error; if (epoch !== this.epoch) return; }
    }
    throw lastError ?? new Error("官方未返回可用的消息连接。");
  }
  private async refreshOfficialRoom(roomId: string, epoch: number) {
    try {
      const signal = this.requests?.signal; if (!signal) return;
      const room = await new BilibiliWebApi(this.fetcher, "", signal).room(roomId);
      if (epoch === this.epoch && room.room_id === this.state.roomId) this.change({ roomName: room.title, roomCover: room.user_cover, roomDescription: room.description });
    } catch { /* Optional display metadata does not interrupt the official connection. */ }
  }
  private async openWeb(epoch: number) {
    const web = this.web; if (!web || epoch !== this.epoch) return;
    const prepared = await web.prepare(this.webRoomId);
    if (epoch !== this.epoch) return;
    this.change({ roomId: prepared.room.room_id, roomName: prepared.room.title, roomCover: prepared.room.user_cover, roomDescription: prepared.room.description, broadcast: "unknown" });
    const revision = this.broadcastRevision;
    let lastError: unknown;
    let attached = false;
    for (const link of prepared.links) {
      try {
        await this.attach(link, prepared.auth, epoch);
        attached = true; break;
      } catch (error) { lastError = error; if (epoch !== this.epoch) return; if (error instanceof BiliAccessError) throw error; }
    }
    if (!attached) throw lastError ?? new LiveOperationError("网页直播未返回可用的消息连接。");
    if (revision !== this.broadcastRevision) { this.retryCount = 0; return; }
    const room = await web.room(prepared.room.room_id);
    if (room.room_id !== prepared.room.room_id) throw new LiveOperationError("网页直播间信息与当前连接不一致。");
    if (epoch === this.epoch && this.state.connection === "connected" && this.broadcastRevision === revision) {
      this.change({ roomName: room.title, roomCover: room.user_cover, roomDescription: room.description, broadcast: room.live_status === 1 ? "live" : [0, 2].includes(room.live_status) ? "offline" : "unknown" });
    }
    if (epoch === this.epoch && this.state.connection === "connected") this.retryCount = 0;
  }
  private attach(url: string, auth: string, epoch: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = this.socketFactory(url); this.socket = ws; ws.binaryType = "arraybuffer";
      let authorized = false, settled = false, lastHeartbeat = Date.now();
      const timeout = setTimeout(() => fail(new Error("官方消息连接超时。")), 15_000);
      const fail = (error: Error) => { if (settled) return; settled = true; clearTimeout(timeout); if (ws === this.socket) this.rejectSocket = undefined; ws.close(); reject(error); };
      this.rejectSocket = fail;
      ws.onopen = () => {
        if (settled || epoch !== this.epoch || ws !== this.socket) { fail(new Error("连接已取消。")); return; }
        try { ws.send(biliPacket(7, auth)); } catch { fail(new Error("官方消息连接已关闭。")); }
      };
      ws.onmessage = event => {
        if (epoch !== this.epoch || ws !== this.socket) return;
        try {
          if (!(event.data instanceof ArrayBuffer)) throw new Error("官方消息格式无效。");
          for (const packet of decodeBiliPackets(Buffer.from(event.data))) {
            if (packet.operation === 8) {
              if (z.object({ code: z.literal(0) }).safeParse(packet.body).success) {
                authorized = true; settled = true; clearTimeout(timeout); if (!this.web) this.retryCount = 0;
                this.rejectSocket = undefined;
                this.change({ connection: "connected" });
                ws.send(biliPacket(2, ""));
                if (this.timer) clearInterval(this.timer);
                this.timer = setInterval(() => {
                  if (epoch !== this.epoch || ws !== this.socket) return;
                  if (Date.now() - lastHeartbeat > 45_000) { ws.close(); return; }
                  try { ws.send(biliPacket(2, "")); } catch { ws.close(); return; }
                  if (!this.web) void this.api("/v2/app/heartbeat", JSON.stringify({ game_id: this.gameId })).catch(error => {
                    if (epoch !== this.epoch) return;
                    if (error instanceof BiliAccessError) this.fatal(error); else ws.close();
                  });
                }, 20_000); this.timer.unref();
                resolve();
              } else fail(new BiliAccessError(this.web ? "网页消息鉴权失败，请更新登录态后重试。" : "官方消息鉴权失败，请检查项目与消息权限。"));
            } else if (authorized && packet.operation === 3) {
              lastHeartbeat = Date.now();
            } else if (authorized && packet.operation === 5) {
              const messages = this.web ? parseBiliWebEvents(packet.body, this.state.roomId) : [parseBiliEvent(packet.body, this.state.roomId, this.gameId)];
              for (const message of messages) {
              if (!message) continue;
              if (this.web && (message.kind === "started" || message.kind === "ended")) {
                if (this.state.broadcast === (message.kind === "started" ? "live" : "offline")) continue;
                message.id += `:${this.broadcastRevision + 1}`;
              }
              if (this.seen.has(message.id)) continue;
              this.seen.set(message.id, Date.now());
              while (this.seen.size > 4000) this.seen.delete(this.seen.keys().next().value!);
              if (message.kind === "started") { this.broadcastRevision++; this.change({ broadcast: "live" }); }
              if (message.kind === "ended") { this.broadcastRevision++; this.change({ broadcast: "offline" }); }
              this.onEvent(message);
              if (message.kind === "interaction-ended") ws.close();
              }
            }
          }
        } catch { if (!authorized) fail(new Error("官方消息解析失败。")); else ws.close(); }
      };
      ws.onerror = () => { if (!authorized) fail(new Error("官方消息连接失败。")); else ws.close(); };
      ws.onclose = () => {
        if (!authorized) fail(new Error("官方消息连接已关闭。"));
        if (epoch === this.epoch && authorized && ws === this.socket) this.reconnect(epoch);
      };
    });
  }
  private reconnect(epoch: number) {
    const socket = this.socket; this.socket = undefined; socket?.close();
    if (this.timer) clearInterval(this.timer);
    this.change({ connection: "reconnecting", broadcast: "unknown" });
    const delay = Math.min(30_000, 1000 * 2 ** Math.min(this.retryCount++, 5));
    diagnostic("info", "live.reconnecting", { attempt: this.retryCount });
    this.retry = setTimeout(() => {
      const previous = this.gameId; this.gameId = "";
      void this.end(previous).then(() => this.open(epoch)).catch(error => {
        if (epoch !== this.epoch) return;
        if (error instanceof BiliAccessError) this.fatal(error);
        else if (this.retryCount >= 8) this.fatal(new LiveOperationError("直播连接恢复失败，请检查网络并重新连接。"));
        else this.reconnect(epoch);
      });
    }, delay); this.retry.unref();
  }
  private fatal(error: Error) {
    this.cancelPending();
    const gameId = this.gameId; this.gameId = ""; void this.end(gameId);
    this.change({ connection: "error", broadcast: "unknown" }); this.onFailure(error);
  }
  private async end(gameId: string, credentials = this.credentials) {
    if (!gameId || !credentials) return;
    await this.api("/v2/app/end", `{"app_id":${credentials.appId},"game_id":${JSON.stringify(gameId)}}`, credentials).catch(() => {});
  }
  cancelPending() {
    ++this.epoch;
    this.requests?.abort(); this.requests = undefined;
    this.rejectSocket?.(new Error("连接已取消。")); this.rejectSocket = undefined;
    if (this.timer) clearInterval(this.timer);
    if (this.retry) clearTimeout(this.retry);
    const socket = this.socket; this.socket = undefined; socket?.close();
  }
  async disconnect() {
    this.cancelPending();
    const credentials = this.credentials; this.credentials = undefined;
    this.web = undefined; this.webRoomId = "";
    const gameId = this.gameId; this.gameId = "";
    this.change({ connection: "disconnected", broadcast: "unknown" });
    await this.end(gameId, credentials);
  }
}
