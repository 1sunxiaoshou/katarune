import { afterEach, describe, expect, it, vi } from "vitest";
import protobuf from "protobufjs/minimal.js";
import { BilibiliConnection } from "../src/main/live/bilibili";
import { BilibiliWebApi, normalizeWebCookie, parseBiliWebEvents, signBiliWeb } from "../src/main/live/bilibiliWeb";
import type { LiveEvent } from "../src/shared/live";
import { SocketFixture } from "./bilibili-socket.fixture";

const instances: BilibiliConnection[] = [];
afterEach(async () => { for (const instance of instances.splice(0)) await instance.disconnect(); vi.useRealTimers(); });
const response = (data: unknown) => new Response(JSON.stringify({ code: 0, data }));
const room = (status = 1) => ({ room_id: 101, uid: 200, title: "合成房间", live_status: status, user_cover: "http://i0.hdslb.com/bfs/live/synthetic.jpg", description: "<p>合成简介</p>" });
const nav = (loggedIn = false) => ({ isLogin: loggedIn, ...(loggedIn ? { mid: 300 } : {}), wbi_img: {
  img_url: `https://i0.hdslb.com/bfs/wbi/${"a".repeat(32)}.png`, sub_url: `https://i0.hdslb.com/bfs/wbi/${"b".repeat(32)}.png`,
} });
function fixture(status = 1, loggedIn = false) {
  const sockets: SocketFixture[] = [], events: LiveEvent[] = [];
  const fetcher = vi.fn<typeof fetch>(async input => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/spi")) return response({ b_3: "synthetic-device" });
    if (url.pathname.endsWith("/nav")) return response(nav(loggedIn));
    if (url.pathname.endsWith("/get_info")) return response(room(status));
    if (url.pathname.endsWith("/getDanmuInfo")) return response({ token: "synthetic-token", host_list: [{ host: "broadcastlv.chat.bilibili.com", wss_port: 443 }] });
    throw new Error("Unexpected fixture request");
  });
  const connection = new BilibiliConnection(fetcher, url => { const socket = new SocketFixture(url); sockets.push(socket); return socket; });
  instances.push(connection); connection.onEvent = value => events.push(value);
  const authenticate = async () => { await vi.waitFor(() => expect(sockets.at(-1)?.readyState).toBe(0)); const socket = sockets.at(-1)!; socket.open(); socket.receive(8, { code: 0 }); return socket; };
  return { connection, fetcher, events, sockets, authenticate };
}
const dm = { cmd: "DANMU_MSG:4:0:2:2:2:0", info: [[0, 1, 25, 0, 1000, 42], "我送了一份礼物", [12, "观众"]] };

describe("web protocol boundaries", () => {
  it("validates display metadata without allowing arbitrary cover origins", async () => {
    const make = (data: unknown) => new BilibiliWebApi(async () => response(data), "", new AbortController().signal);
    expect(await make(room()).room("101")).toMatchObject({ description: "<p>合成简介</p>", user_cover: "https://i0.hdslb.com/bfs/live/synthetic.jpg" });
    expect(await make({ ...room(), description: "长".repeat(9000), user_cover: "https://i0.hdslb.com.invalid/track" }).room("101")).toMatchObject({ description: "长".repeat(8000), user_cover: "" });
    expect(await make({ ...room(), description: null, user_cover: "file:///private" }).room("101")).toMatchObject({ description: "", user_cover: "" });
  });

  it("filters unrelated cookies and never accepts header injection", () => {
    expect(normalizeWebCookie("SESSDATA=encoded%2Cvalue; unrelated=drop; buvid3=device")).toBe("SESSDATA=encoded%2Cvalue; buvid3=device");
    expect(normalizeWebCookie("")).toBe("");
    expect(() => normalizeWebCookie("SESSDATA=value\r\nX-Test: x")).toThrow();
    expect(() => normalizeWebCookie("bare-token")).toThrow();
    expect(() => normalizeWebCookie("unrelated=value")).toThrow();
  });
  it("signs deterministic sorted web requests with a finite timestamp", () => {
    const signed = signBiliWeb({ type: "0", id: "101" }, "a".repeat(32), "b".repeat(32), 1700000000000);
    expect(signed).toMatch(/^id=101&type=0&wts=1700000000&w_rid=[a-f0-9]{32}$/);
    expect(signBiliWeb({ id: "101", type: "0" }, "a".repeat(32), "b".repeat(32), 1700000000000)).toBe(signed);
    expect(() => signBiliWeb({}, "short", "short")).toThrow();
  });
  it("preserves ordinary viewer text and rejects unknown, malformed and foreign events", () => {
    expect(parseBiliWebEvents(dm, "101")[0]).toMatchObject({ kind: "danmaku", text: "我送了一份礼物", userName: "观众", userId: "12" });
    expect(parseBiliWebEvents({ cmd: "SEND_GIFT", data: { giftName: "礼物" } }, "101")).toEqual([]);
    expect(parseBiliWebEvents({ cmd: "UNKNOWN", data: { text: "gift" } }, "101")).toEqual([]);
    expect(parseBiliWebEvents({ cmd: "LIVE", roomid: 102 }, "101")).toEqual([]);
    expect(parseBiliWebEvents({ cmd: "PREPARING", roomid: 101 }, "101")[0]?.kind).toBe("ended");
  });
  it("decodes protobuf danmaku without truncating large user IDs", () => {
    const writer = protobuf.Writer.create().uint32(10).string("message-id").uint32(50).string("新版弹幕").uint32(56).int64(1700000000);
    writer.uint32(162).fork().uint32(8).uint64("9007199254740993").uint32(18).string("观众").ldelim();
    const bytes = writer.finish();
    expect(parseBiliWebEvents({ cmd: "DANMU_MSG", dm_v2: Buffer.from(bytes).toString("base64") }, "101")[0]).toMatchObject({ kind: "danmaku", text: "新版弹幕", userId: "9007199254740993", userName: "观众" });
    expect(parseBiliWebEvents({ cmd: "DANMU_MSG", dm_v2: "invalid!" }, "101")).toEqual([]);
  });
  it("takes real gift notifications and every result in protobuf batches", () => {
    const gift = { cmd: "SEND_GIFT", data: { giftId: 1, giftName: "花", num: 2, uid: 12, uname: "观众", timestamp: 1000, tid: "transaction" } };
    expect(parseBiliWebEvents(gift, "101")[0]).toMatchObject({ kind: "gift", giftName: "花", quantity: 2 });
    const writer = protobuf.Writer.create().uint32(8).uint64(12).uint32(18).string("观众");
    for (let index = 1; index <= 2; index++) writer.uint32(82).fork().uint32(8).uint32(1).uint32(18).string("花").uint32(24).uint32(1).uint32(74).string("batch-transaction").uint32(80).uint64(1000).ldelim();
    const events = parseBiliWebEvents({ cmd: "SEND_GIFT_V2", data: { pb: Buffer.from(writer.finish()).toString("base64") } }, "101");
    expect(events.map(event => event.giftName)).toEqual(["花", "花"]);
    expect(new Set(events.map(event => event.id)).size).toBe(2);
  });
});

describe("web connection lifecycle", () => {
  it("authenticates a short room ID, then confirms initial on-air status", async () => {
    const f = fixture(1, true), attempt = f.connection.connectWeb({ roomId: "1", cookie: "SESSDATA=synthetic-session" });
    const socket = await f.authenticate(); await attempt;
    const auth = JSON.parse(Buffer.from(zeroCopy(socket.sentData[0])).subarray(16).toString());
    expect(auth).toMatchObject({ uid: 300, roomid: 101, protover: 3, platform: "web", key: "synthetic-token", buvid: "synthetic-device" });
    expect(JSON.stringify(auth)).not.toContain("synthetic-session");
    expect(f.connection.status).toMatchObject({ connection: "connected", broadcast: "live", roomId: "101", roomName: "合成房间", roomDescription: "<p>合成简介</p>", roomCover: "https://i0.hdslb.com/bfs/live/synthetic.jpg" });
    const danmakuRequest = f.fetcher.mock.calls.find(([input]) => String(input).includes("getDanmuInfo"));
    expect(String(danmakuRequest?.[0])).toContain("w_rid=");
    expect(f.fetcher.mock.calls.some(([input]) => String(input).includes("/v2/app/"))).toBe(false);
    socket.receive(5, dm); socket.receive(5, dm); expect(f.events).toHaveLength(1);
    socket.receive(5, { cmd: "PREPARING", roomid: 101 }); expect(f.connection.status.broadcast).toBe("offline");
    socket.receive(5, { cmd: "LIVE", roomid: 101 }); socket.receive(5, { cmd: "PREPARING", roomid: 101 });
    expect(f.connection.status.broadcast).toBe("offline");
    expect(new Set(f.events.map(event => event.id)).size).toBe(f.events.length);
  });
  it("keeps unknown status gated and refreshes the status after reconnect", async () => {
    vi.useFakeTimers();
    const f = fixture(3), attempt = f.connection.connectWeb({ roomId: "101", cookie: "" }), first = await f.authenticate(); await attempt;
    expect(f.connection.status.broadcast).toBe("unknown"); first.receive(5, dm); expect(f.connection.status.broadcast).toBe("unknown");
    first.close(); expect(f.connection.status.broadcast).toBe("unknown");
    await vi.advanceTimersByTimeAsync(1000); await f.authenticate();
    await vi.waitFor(() => expect(f.connection.status.connection).toBe("connected"));
    first.receive(5, { cmd: "LIVE", roomid: 101 }); expect(f.connection.status.broadcast).toBe("unknown");
  });
  it("does not let a late HTTP status override a newer room event", async () => {
    const f = fixture(); let reads = 0, complete: ((value: Response) => void) | undefined;
    const original = f.fetcher.getMockImplementation()!;
    f.fetcher.mockImplementation(async (...args) => {
      if (String(args[0]).includes("get_info") && ++reads === 2) return new Promise(resolve => { complete = resolve; });
      return original(...args);
    });
    const attempt = f.connection.connectWeb({ roomId: "101", cookie: "" }), socket = await f.authenticate();
    await vi.waitFor(() => expect(complete).toBeDefined());
    socket.receive(5, { cmd: "PREPARING", roomid: 101 }); complete!(response(room(1))); await attempt;
    expect(f.connection.status.broadcast).toBe("offline");
  });
  it("rejects expired login state without starting a socket or exposing cookies", async () => {
    const f = fixture();
    await expect(f.connection.connectWeb({ roomId: "101", cookie: "SESSDATA=synthetic-expired" })).rejects.toThrow("登录态已失效");
    expect(f.sockets).toHaveLength(0); expect(f.connection.status.connection).toBe("error");
  });
  it("bounds reconnect attempts when auth succeeds but room confirmation keeps failing", async () => {
    vi.useFakeTimers();
    const f = fixture(), attempt = f.connection.connectWeb({ roomId: "101", cookie: "" }), first = await f.authenticate(); await attempt;
    let reads = 0; const original = f.fetcher.getMockImplementation()!;
    f.fetcher.mockImplementation(async (...args) => {
      if (String(args[0]).includes("get_info")) return ++reads % 2 ? response(room()) : new Response(JSON.stringify({ code: -500 }));
      return original(...args);
    });
    const failed = vi.fn(); f.connection.onFailure = failed; first.close();
    for (let retry = 0; retry < 8; retry++) {
      await vi.advanceTimersByTimeAsync(Math.min(30_000, 1000 * 2 ** Math.min(retry, 5)));
      await f.authenticate();
      await vi.waitFor(() => expect(f.connection.status.connection).toBe(retry === 7 ? "error" : "reconnecting"));
    }
    expect(failed).toHaveBeenCalledOnce();
    const requests = f.fetcher.mock.calls.length; await vi.advanceTimersByTimeAsync(120000); expect(f.fetcher.mock.calls).toHaveLength(requests);
  });
  it("aborts pending web HTTP and websocket authentication on stop", async () => {
    let aborted = false;
    const connection = new BilibiliConnection(async (_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => { aborted = true; reject(new Error("aborted")); }, { once: true });
    })); instances.push(connection);
    const attempt = connection.connectWeb({ roomId: "101", cookie: "" }); const rejected = expect(attempt).rejects.toBeDefined();
    await vi.waitFor(() => expect(connection.status.connection).toBe("connecting")); connection.cancelPending(); await rejected;
    expect(aborted).toBe(true);
    const f = fixture(), pending = f.connection.connectWeb({ roomId: "101", cookie: "" }); const stopped = expect(pending).rejects.toThrow("取消");
    await vi.waitFor(() => expect(f.sockets).toHaveLength(1)); f.connection.cancelPending(); await stopped;
    f.sockets[0]!.open(); expect(f.sockets[0]!.sent).toBe(0);
  });
  it("keeps endpoint redirects and non-bilibili websocket hosts out of the connection", async () => {
    const fetcher = vi.fn<typeof fetch>(async input => {
      const url = String(input);
      if (url.includes("/spi")) return response({ b_3: "device" });
      if (url.includes("/nav")) return response(nav());
      if (url.includes("/get_info")) return response(room());
      return response({ token: "token", host_list: [{ host: "attacker.example", wss_port: 443 }] });
    });
    await expect(new BilibiliWebApi(fetcher, "", new AbortController().signal).prepare("101")).rejects.toThrow();
    expect(fetcher.mock.calls.every(([, options]) => options?.redirect === "error")).toBe(true);
  });
});
function zeroCopy(value: unknown): Uint8Array { if (!(value instanceof Uint8Array)) throw new Error("Missing binary auth"); return value; }
