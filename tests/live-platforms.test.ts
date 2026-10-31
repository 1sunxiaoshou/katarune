import { describe, expect, it, vi } from "vitest";
import { WebSocket, WebSocketServer } from "ws";
import protobuf from "protobufjs/minimal.js";
import { gzipSync } from "node:zlib";
import { signDouyinStub, douyinStub } from "../src/main/live/douyinSignature";
import { DouyinConnection, decodeDouyin, decodeDouyinFrame, parseDouyinEvent } from "../src/main/live/douyin";
import { PlatformHttp } from "../src/main/live/platformHttp";
import { LiveLoginService, validateLiveAccount } from "../src/main/live/login";
import { DEFAULT_LIVE_SETTINGS, liveRoomCoverSchema } from "../src/shared/live";
import { advanceDouyinQrStatus, parseDouyinQr, parseDouyinQrStatus, type DouyinLoginBrowser, type DouyinQrStatus } from "../src/main/live/douyinLoginProtocol";

describe("webcast signing and external events", () => {
  it('accepts only trusted HTTPS platform cover sources at the IPC boundary', () => {
    expect(liveRoomCoverSchema.parse('https://p3-webcast.douyinpic.com/synthetic-cover.jpg')).toContain('douyinpic.com');
    expect(liveRoomCoverSchema.parse('https://i0.hdslb.com/synthetic-cover.jpg')).toContain('hdslb.com');
    expect(liveRoomCoverSchema.parse('')).toBe('');
    for (const invalid of ['https://douyinpic.com.example.invalid/cover', 'http://p3.douyinpic.com/cover', 'https://p3.douyinpic.com:8443/cover', 'https://user:secret@p3.douyinpic.com/cover', 'javascript:alert(1)']) {
      expect(liveRoomCoverSchema.safeParse(invalid).success).toBe(false);
    }
  });
  it("matches a synthetic browser SDK signature vector without loading its code", () => {
    // Generated using the SDK with an all-zero synthetic MD5, first request counter,
    // then decoded only to recover its RC4 key/salt. No live request or credentials.
    expect(signDouyinStub("0".repeat(32), Uint8Array.from([183, 28]))).toBe("fBWyCQpZdG8HNJKK");
    expect(douyinStub("101", "9007199254740993")).not.toBe(douyinStub("102", "9007199254740993"));
    expect(() => douyinStub("x", "123")).toThrow();
  });
  it("decodes compressed messages and an ACK, preserving large IDs and rejecting foreign rooms", () => {
    const chat = protobuf.Writer.create();
    chat.uint32(10).fork().uint32(16).uint64("9007199254740993").uint32(24).uint64(101).uint32(32).uint64(1700000000).ldelim();
    chat.uint32(18).fork().uint32(8).uint64("9007199254740995").uint32(26).string("合成观众").ldelim().uint32(26).string("你好");
    const batch = protobuf.Writer.create().uint32(10).fork().uint32(10).string("WebcastChatMessage").uint32(18).bytes(chat.finish()).uint32(24).uint64(12).ldelim().uint32(42).string("synthetic-ack").uint32(72).bool(true).finish();
    const frame = protobuf.Writer.create().uint32(16).uint64("9007199254740997").uint32(50).string("gzip").uint32(58).string("msg").uint32(66).bytes(gzipSync(batch)).finish();
    const decoded = decodeDouyinFrame(frame);
    expect(decoded.ack).toBeInstanceOf(Uint8Array);
    expect(decodeDouyin('Frame', decoded.ack!)).toMatchObject({ logId: '9007199254740997', type: 'ack', payload: Buffer.from('synthetic-ack') });
    expect(parseDouyinEvent(decoded.messages[0]!, "101")).toMatchObject({ platform: "douyin", userId: "9007199254740995", userName: "合成观众", text: "你好" });
    expect(parseDouyinEvent(decoded.messages[0]!, "102")).toBeNull();
    expect(() => decodeDouyinFrame(new Uint8Array(3 * 1024 * 1024))).toThrow();
    expect(() => decodeDouyinFrame(new Uint8Array())).toThrow();
  });
  it("rejects oversized gzip payloads", () => {
    const frame = protobuf.Writer.create().uint32(66).bytes(gzipSync(Buffer.alloc(3 * 1024 * 1024))).finish();
    expect(() => decodeDouyinFrame(frame)).toThrow();
  });
});

const json = (value: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(value), { headers });
function loginFixture(fetcher: typeof fetch, beforePut: () => Promise<void> = async () => {}, browser?: () => DouyinLoginBrowser) {
  let bili: string | null = null, douyin: string | null = null, puts = 0;
  const values = new Map<string, string>();
  const credentials = { put: async (value: string) => { await beforePut(); const id = `reference-${++puts}`; values.set(id, value); return id; }, resolve: async (id: string) => values.get(id)!, delete: async (id: string) => { values.delete(id); } };
  let now = 1000;
  const database = { getLiveConfig: () => ({ settings: DEFAULT_LIVE_SETTINGS, credentialRef: null, webCredentialRef: bili, douyinCredentialRef: douyin }),
    setLiveWebCredentialRef: (value: string | null) => { bili = value; }, setLiveDouyinCredentialRef: (value: string | null) => { douyin = value; } };
  return { service: new LiveLoginService(database, credentials, fetcher, () => now, browser), database, values, advance: (ms = 200000) => { now += ms; } };
}
describe('official-page Douyin login', () => {
  it('pins valid official QR responses and keeps scan/verification progress monotonic', () => {
    const qr = { data: { error_code: 0, token: 'synthetic-token', qrcode_index_url: 'https://www.douyin.com/synthetic-qr', expire_time: 60 } };
    expect(parseDouyinQr(qr, 1000)?.expiresAt).toBe(60000);
    expect(parseDouyinQr({ data: { ...qr.data, error_code: 4031 } }, 1000)).toBeNull();
    expect(parseDouyinQr({ data: { ...qr.data, qrcode_index_url: 'https://example.invalid/qr' } }, 1000)).toBeNull();
    expect(parseDouyinQrStatus({ data: { error_code: 2046, status: 'confirmed' } })).toBe('verification');
    expect(parseDouyinQrStatus({ data: { error_code: 4031, status: 'confirmed' } })).toBeNull();
    expect(advanceDouyinQrStatus('scanned', 'waiting')).toBe('scanned');
    expect(advanceDouyinQrStatus('confirmed', 'scanned')).toBe('confirmed');
    expect(advanceDouyinQrStatus('confirmed', 'verification')).toBe('verification');
    expect(advanceDouyinQrStatus('verification', 'expired')).toBe('verification');
  });
  it('waits for authenticated account validation after browser confirmation and closes the isolated session', async () => {
    let status: DouyinQrStatus = 'verification', verified = false, closed = 0, opened = 0;
    const browser: DouyinLoginBrowser = {
      start: async () => ({ token: 'synthetic-token', url: 'https://www.douyin.com/synthetic-qr', expiresAt: 10000 }),
      open: async () => {}, poll: async () => status, cookie: async () => 'sessionid=synthetic-secret',
      showVerification: () => { opened++; }, close: () => { closed++; },
      fetcher: async () => verified ? json({ status_code: 0, data: { id_str: '124', nickname: '合成主播' } }) : new Response('temporary verification page'),
    };
    const f = loginFixture(async () => { throw new Error('Must use the isolated page'); }, async () => {}, () => browser);
    const started = await f.service.start('douyin');
    expect((await f.service.poll(started.id)).status).toBe('verification');
    f.service.showVerification(started.id); expect(opened).toBe(1);
    status = 'confirmed'; f.advance(20000);
    expect((await f.service.poll(started.id)).status).toBe('scanned');
    expect(f.values.size).toBe(0); expect(closed).toBe(0);
    verified = true; f.advance(2000);
    const completed = await f.service.poll(started.id);
    expect(completed.status).toBe('completed'); expect(f.values.size).toBe(1); expect(closed).toBe(1);
    expect(JSON.stringify(completed)).not.toContain('synthetic-secret');
    expect(() => f.service.showVerification(started.id)).toThrow();
  });
});
describe("QR login and credential isolation", () => {
  it('accepts platform avatar URLs and ignores untrusted avatar metadata without changing the verified identity', async () => {
    const fetcher = (avatar: unknown) => async () => json({ status_code: 0, data: { id_str: '124', nickname: '合成主播', avatar_medium: { url_list: [avatar] } } });
    const signal = new AbortController().signal;
    const avatarUrl = 'https://p3.douyinpic.com/synthetic-avatar.png';
    expect(await validateLiveAccount('douyin', new PlatformHttp('douyin.com', fetcher(avatarUrl)), signal)).toMatchObject({ id: '124', avatarUrl });
    for (const invalid of ['http://p3.douyinpic.com/avatar.png', 'https://example.invalid/avatar.png', 'https://p3.douyinpic.com:8443/avatar.png', 'https://user:secret@p3.douyinpic.com/avatar.png']) {
      expect(await validateLiveAccount('douyin', new PlatformHttp('douyin.com', fetcher(invalid)), signal)).toEqual({ platform: 'douyin', id: '124', name: '合成主播' });
    }
  });
  it("stores only verified Bilibili cookies in the credential store and returns account metadata", async () => {
    const f = loginFixture(async (input, init) => {
      const path = new URL(String(input)).pathname;
      expect(init?.credentials).toBe('omit');
      if (path.endsWith("/generate")) return json({ code: 0, data: { qrcode_key: "synthetic-key", url: "https://passport.bilibili.com/synthetic-qr" } });
      if (path.endsWith("/poll")) return json({ code: 0, data: { code: 0 } }, { "set-cookie": "SESSDATA=synthetic-secret; Domain=.bilibili.com; Path=/; Secure; HttpOnly" });
      expect(new Headers(init?.headers).get("cookie")).toContain("SESSDATA=synthetic-secret");
      if (path.endsWith('/getRoomInfoOld')) return json({ code: 0, data: { roomStatus: 1, roomid: 101 } });
      return json({ code: 0, data: { isLogin: true, mid: 123, uname: "合成主播" } });
    });
    const started = await f.service.start("bilibili");
    expect(started.qrImage).toMatch(/^data:image\/png;base64,/);
    const completed = await f.service.poll(started.id);
    expect(completed).toMatchObject({ status: "completed", qrImage: "", account: { platform: "bilibili", id: "123", name: "合成主播" } });
    expect(JSON.stringify(completed)).not.toContain("synthetic-secret");
    expect(f.database.getLiveConfig().douyinCredentialRef).toBeNull();
    expect(await f.service.accounts()).toHaveLength(1);
    expect(await f.service.ownRoom('bilibili', new AbortController().signal)).toBe('101');
    await f.service.logout("bilibili"); expect(f.values.size).toBe(0);
  });
  it("does not store credentials when account verification fails or the QR expires", async () => {
    const f = loginFixture(async input => String(input).includes("generate") ? json({ code: 0, data: { qrcode_key: "synthetic-key", url: "https://passport.bilibili.com/synthetic-qr" } }) : json({ code: 0, data: { code: 0, isLogin: false } }));
    const a = await f.service.start("bilibili");
    expect((await f.service.poll(a.id)).status).toBe("error"); expect(f.values.size).toBe(0);
    const b = await f.service.start("bilibili"); f.advance();
    expect((await f.service.poll(b.id)).status).toBe("expired"); expect(f.values.size).toBe(0);
  });
  it("cancels stale QR results, preventing an old login from replacing a newer attempt", async () => {
    let finish: ((value: Response) => void) | undefined;
    const f = loginFixture(async () => new Promise(resolve => { finish = resolve; }));
    const pending = f.service.start("bilibili"); f.service.cancel();
    finish!(json({ code: 0, data: { qrcode_key: "old-key", url: "https://passport.bilibili.com/synthetic-qr" } }));
    expect((await pending).status).toBe("cancelled"); expect(f.values.size).toBe(0);
  });
  it("rejects cross-site redirects before forwarding any cookie", async () => {
    let requests = 0;
    const http = new PlatformHttp("douyin.com", async () => { requests++; return new Response(null, { status: 302, headers: { location: "https://example.invalid/steal" } }); });
    http.importCookie("sessionid=synthetic-secret", "https://live.douyin.com/");
    await expect(http.request("https://login.douyin.com/", new AbortController().signal)).rejects.toThrow("不允许");
    expect(requests).toBe(1);
    expect(() => http.importCookie("sessionid=x\r\nInjected=x", "https://live.douyin.com/")).toThrow();
    http.importCookie('=synthetic-tracking; sessionid=synthetic-valid', 'https://live.douyin.com/');
    expect(http.cookie('https://live.douyin.com/')).toBe('sessionid=synthetic-valid');
    expect(() => http.importCookie('invalid named cookie', 'https://live.douyin.com/')).toThrow('格式无效');
  });
  it('removes a newly encrypted credential when login is cancelled during its write', async () => {
    let release: (() => void) | undefined;
    const f = loginFixture(async input => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith('/generate')) return json({ code: 0, data: { qrcode_key: 'synthetic-key', url: 'https://passport.bilibili.com/synthetic-qr' } });
      if (path.endsWith('/poll')) return json({ code: 0, data: { code: 0 } }, { 'set-cookie': 'SESSDATA=synthetic-secret; Domain=.bilibili.com; Path=/; Secure' });
      return json({ code: 0, data: { isLogin: true, mid: 123, uname: '合成主播' } });
    }, () => new Promise<void>(resolve => { release = resolve; }));
    const started = await f.service.start('bilibili');
    const pending = f.service.poll(started.id);
    await vi.waitFor(() => expect(release).toBeDefined());
    f.service.cancel(); release!();
    expect((await pending).status).toBe('cancelled');
    expect(f.values.size).toBe(0); expect(f.database.getLiveConfig().webCredentialRef).toBeNull();
  });
  it("reports Douyin challenges without claiming login success", async () => {
    const f = loginFixture(async input => String(input).includes("get_qrcode") ? json({ data: { error_code: 4031, captcha: "synthetic-challenge" } }) : new Response("homepage"));
    const result = await f.service.start("douyin");
    expect(result.status).toBe("error"); expect(result.message).toContain("4031"); expect(f.values.size).toBe(0);
    expect(JSON.stringify(result)).not.toContain("synthetic-challenge");
  });
  it("completes a Douyin QR callback with domain-scoped cookies and keeps the Bilibili account separate", async () => {
    let roomData = '';
    const f = loginFixture(async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname.includes("get_qrcode")) return json({ data: { token: "synthetic-qr-token", qrcode_index_url: "https://www.douyin.com/synthetic-qr" } });
      if (url.pathname.includes("check_qrconnect")) return json({ data: { status: "3", redirect_url: "https://www.douyin.com/synthetic-callback" } });
      if (url.pathname === "/synthetic-callback") return new Response(null, { status: 302, headers: { location: "https://live.douyin.com/", "set-cookie": "sessionid=synthetic-secret; Domain=.douyin.com; Path=/; Secure; HttpOnly" } });
      if (url.pathname.includes("/user/me/")) {
        expect(new Headers(init?.headers).get("cookie")).toContain("sessionid=synthetic-secret");
        return json({ status_code: 0, data: { id_str: "9007199254740997", nickname: "合成主播" } });
      }
      if (url.pathname.includes('/profile/self/')) return json({ status_code: 0, user: { uid: '9007199254740997', room_data: roomData, room_id: '999', display_id: 'synthetic-account-name' } });
      return new Response("homepage");
    });
    const a = await f.service.start("douyin");
    const result = await f.service.poll(a.id);
    expect(result.status).toBe("completed");
    expect(result.account?.id).toBe("9007199254740997");
    expect(f.database.getLiveConfig().webCredentialRef).toBeNull();
    expect(f.database.getLiveConfig().douyinCredentialRef).not.toBeNull();
    expect(JSON.stringify(result)).not.toContain("synthetic-secret");
    expect(await f.service.ownRoom('douyin', new AbortController().signal)).toBeNull();
    for (const absent of ['null', '{}', '{"owner":null}']) {
      roomData = absent;
      expect(await f.service.ownRoom('douyin', new AbortController().signal)).toBeNull();
    }
    for (const malformed of ['invalid-json', '{"owner":{"web_rid":"invalid"}}']) {
      roomData = malformed;
      await expect(f.service.ownRoom('douyin', new AbortController().signal)).rejects.toThrow('信息无效');
    }
    roomData = JSON.stringify({ id_str: '999', owner: { web_rid: '102' } });
    expect(await f.service.ownRoom('douyin', new AbortController().signal)).toBe('102');
  });
});

describe("Douyin socket lifecycle", () => {
  it('polls independently of heartbeats, backs off failures, ignores stale live replies after an end and reconnects a new broadcast', async () => {
    const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    await new Promise<void>(resolve => server.on('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing fixture address');
    let peer: WebSocket | undefined, requests = 0, roomId = '101', roomStatus = 4;
    let mode: 'ok' | 'error' | 'hold' = 'ok';
    let release: ((response: Response) => void) | undefined;
    const response = () => json({ status_code: 0, data: { data: [{ id_str: roomId, title: '合成房间', status: roomStatus }] } });
    server.on('connection', socket => { peer = socket; });
    const connection = new DouyinConnection(async () => {
      requests++;
      if (mode === 'error') throw new Error('Synthetic request failure');
      if (mode === 'hold') return new Promise<Response>(resolve => { release = resolve; });
      return response();
    }, () => new WebSocket(`ws://127.0.0.1:${address.port}`));
    const states: string[] = [];
    connection.onState = state => states.push(`${state.connection}:${state.broadcast}`);
    const frame = (batch: Uint8Array) => protobuf.Writer.create().uint32(66).bytes(batch).finish();
    const ready = frame(protobuf.Writer.create().uint32(72).bool(false).finish());
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
    try {
      const pending = connection.connectWeb({ roomId: '123', cookie: 'sessionid=synthetic; ttwid=synthetic' });
      await vi.waitFor(() => expect(peer).toBeDefined());
      peer!.send(ready); await pending;
      await vi.waitFor(() => expect(requests).toBe(2));
      expect(states.at(-1)).toBe('connected:offline');
      roomStatus = 2;
      await vi.advanceTimersByTimeAsync(3000);
      expect(states.at(-1)).toBe('connected:live'); expect(requests).toBe(3);
      mode = 'error';
      await vi.advanceTimersByTimeAsync(10000);
      expect(states.at(-1)).toBe('connected:unknown'); expect(requests).toBe(4);
      await vi.advanceTimersByTimeAsync(5999); expect(requests).toBe(4);
      await vi.advanceTimersByTimeAsync(1); expect(requests).toBe(5);
      mode = 'hold';
      await vi.advanceTimersByTimeAsync(12000); expect(release).toBeDefined();
      const inFlight = requests;
      await vi.advanceTimersByTimeAsync(9000); expect(requests).toBe(inFlight);
      const control = protobuf.Writer.create().uint32(10).fork().uint32(16).uint64(30).uint32(24).uint64(101).uint32(32).uint64(1700000000).ldelim().uint32(16).uint32(3).finish();
      const ended = protobuf.Writer.create().uint32(10).fork().uint32(10).string('WebcastControlMessage').uint32(18).bytes(control).uint32(24).uint64(30).ldelim().finish();
      peer!.send(frame(ended));
      await vi.waitFor(() => expect(states.at(-1)).toBe('connected:offline'));
      mode = 'ok'; release!(response());
      await vi.advanceTimersByTimeAsync(3000);
      expect(states.at(-1)).toBe('connected:offline');
      const oldPeer = peer; roomId = '102';
      await vi.advanceTimersByTimeAsync(3000);
      await vi.waitFor(() => expect(states.at(-1)).toBe('reconnecting:unknown'));
      await vi.advanceTimersByTimeAsync(1000);
      await vi.waitFor(() => expect(peer).not.toBe(oldPeer));
      peer!.send(ready);
      await vi.waitFor(() => expect(states.at(-1)).toBe('connected:live'));
      await connection.disconnect();
      const stopped = requests;
      await vi.advanceTimersByTimeAsync(30000);
      expect(requests).toBe(stopped); expect(states.at(-1)).toBe('disconnected:unknown');
    } finally {
      await connection.disconnect(); vi.useRealTimers();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
  it("waits for valid protocol data, signs room-specific connections, de-duplicates and stops cleanly", async () => {
    const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    await new Promise<void>(resolve => server.on("listening", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing fixture address");
    let peer: WebSocket | undefined, requested = "";
    let roomStatus = 4;
    let cover: unknown = { url_list: ['http://127.0.0.1/private', '//p3-webcast.douyinpic.com/synthetic-cover.jpg'] };
    server.on("connection", socket => { peer = socket; });
    const connection = new DouyinConnection(async () => json({ status_code: 0, data: { data: [{ id_str: "101", title: "合成房间", status: roomStatus, cover }] } }), (url, cookie) => {
      requested = url; expect(cookie).toBe("sessionid=synthetic-session");
      return new WebSocket(`ws://127.0.0.1:${address.port}`);
    });
    const states: string[] = [], events: unknown[] = [];
    const covers: string[] = [];
    connection.onState = state => { states.push(`${state.connection}:${state.broadcast}`); covers.push(state.roomCover); };
    connection.onEvent = event => events.push(event);
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
    try {
      const pending = connection.connectWeb({ roomId: "123", cookie: "sessionid=synthetic-session" });
      await vi.waitFor(() => expect(peer).toBeDefined());
      expect(new URL(requested).searchParams.get("signature")).toMatch(/^[A-Za-z0-9+/]{16}$/);
      expect(states).not.toContain("connected:live");
      const chat = protobuf.Writer.create().uint32(10).fork().uint32(16).uint64(12).uint32(24).uint64(101).uint32(32).uint64(1700000000).ldelim().uint32(18).fork().uint32(8).uint64(13).uint32(26).string("合成观众").ldelim().uint32(26).string("合成弹幕").finish();
      const batch = protobuf.Writer.create().uint32(10).fork().uint32(10).string("WebcastChatMessage").uint32(18).bytes(chat).uint32(24).uint64(12).ldelim().finish();
      const packet = protobuf.Writer.create().uint32(66).bytes(gzipSync(batch)).finish();
      peer!.send(packet); peer!.send(packet);
      await pending;
      await vi.waitFor(() => expect(events).toHaveLength(1));
      expect(states).toContain("connected:offline");
      expect(covers.at(-1)).toBe('https://p3-webcast.douyinpic.com/synthetic-cover.jpg');
      roomStatus = 2;
      cover = { url_list: ['https://p9-webcast.douyinpic.com/updated-cover.jpg'] };
      await vi.advanceTimersByTimeAsync(3000);
      await vi.waitFor(() => expect(states).toContain('connected:live'));
      expect(covers.at(-1)).toBe('https://p9-webcast.douyinpic.com/updated-cover.jpg');
      cover = { url_list: ['javascript:alert(1)', 'https://example.invalid/cover.jpg'] };
      await vi.advanceTimersByTimeAsync(10000);
      expect(covers.at(-1)).toBe('https://p9-webcast.douyinpic.com/updated-cover.jpg');
      const gift = (id: number, count: number) => {
        const data = protobuf.Writer.create().uint32(10).fork().uint32(16).uint64(id).uint32(24).uint64(101).uint32(32).uint64(1700000000).ldelim()
          .uint32(16).uint64(30).uint32(40).uint64(count).uint32(58).fork().uint32(8).uint64(13).uint32(26).string('合成观众').ldelim()
          .uint32(88).uint64(40).uint32(122).fork().uint32(80).bool(true).uint32(130).string('合成礼物').ldelim().finish();
        const batch = protobuf.Writer.create().uint32(10).fork().uint32(10).string('WebcastGiftMessage').uint32(18).bytes(data).uint32(24).uint64(id).ldelim().finish();
        return protobuf.Writer.create().uint32(66).bytes(gzipSync(batch)).finish();
      };
      peer!.send(gift(21, 1)); peer!.send(gift(22, 3)); peer!.send(gift(23, 3));
      await vi.waitFor(() => expect(events).toHaveLength(3));
      expect(events.slice(1)).toMatchObject([{ kind: 'gift', quantity: 1 }, { kind: 'gift', quantity: 2 }]);
      peer!.close();
      await vi.waitFor(() => expect(states.at(-1)).toBe('reconnecting:unknown'));
    } finally {
      await connection.disconnect();
      vi.useRealTimers();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
    expect(states.at(-1)).toBe("disconnected:unknown");
  });
});
