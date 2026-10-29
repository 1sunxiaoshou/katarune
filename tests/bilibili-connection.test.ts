import { afterEach, describe, expect, it, vi } from "vitest";
import { BilibiliConnection } from "../src/main/live/bilibili";
import { SocketFixture } from "./bilibili-socket.fixture";
import type { LiveEvent } from "../src/shared/live";

const credentials = { appId: "123", accessKey: "fixture", accessSecret: "fixture", identityCode: "fixture" };
const instances: BilibiliConnection[] = [];
afterEach(async () => { for (const instance of instances.splice(0)) await instance.disconnect(); vi.useRealTimers(); });
function fixture() {
  const sockets: SocketFixture[] = [], events: LiveEvent[] = [];
  let sequence = 0;
  const fetcher = vi.fn<typeof fetch>(async input => new Response(JSON.stringify(String(input).endsWith("/start") ? {
    code: 0, data: { game_info: { game_id: `game-${++sequence}` }, anchor_info: { room_id: 101, uname: "测试" }, websocket_info: { auth_body: "{}", wss_link: ["wss://broadcastlv.chat.bilibili.com/sub"] } },
  } : String(input).includes("/Room/get_info") ? { code: 0, data: { room_id: 101, uid: 200, title: "合成直播标题", description: "简介", user_cover: "https://i0.hdslb.com/bfs/live/fixture.jpg", live_status: 1 } } : { code: 0 })));
  const connection = new BilibiliConnection(fetcher, url => { const socket = new SocketFixture(url); sockets.push(socket); return socket; });
  connection.onEvent = event => events.push(event); instances.push(connection);
  const authenticate = async () => { await vi.waitFor(() => expect(sockets.at(-1)?.readyState).toBe(0)); const socket = sockets.at(-1)!; socket.open(); socket.receive(8, { code: 0 }); return socket; };
  return { connection, fetcher, sockets, events, authenticate };
}
describe("official connection lifecycle", () => {
  it("keeps on-air state unknown until the official start event and deduplicates room events", async () => {
    const f = fixture(), connecting = f.connection.connect(credentials), socket = await f.authenticate(); await connecting;
    await vi.waitFor(() => expect(f.connection.status.roomName).toBe("合成直播标题"));
    expect(f.connection.status.roomDescription).toBe("简介");
    expect(f.connection.status.broadcast).toBe("unknown");
    const ordinary = { cmd: "LIVE_OPEN_PLATFORM_DM", data: { room_id: 101, msg_id: "one", msg: "已开播，我送了礼物" } };
    socket.receive(5, ordinary); socket.receive(5, ordinary);
    socket.receive(5, { cmd: "LIVE_OPEN_PLATFORM_SEND_GIFT", data: { room_id: 102, msg_id: "foreign", gift_id: 1, gift_name: "花", gift_num: 1 } });
    expect(f.events).toHaveLength(1); expect(f.events[0]?.kind).toBe("danmaku"); expect(f.connection.status.broadcast).toBe("unknown");
    socket.receive(5, { cmd: "LIVE_OPEN_PLATFORM_LIVE_START", data: { room_id: 101, timestamp: 100 } });
    expect(f.connection.status.broadcast).toBe("live");
    socket.receive(5, { cmd: "LIVE_OPEN_PLATFORM_LIVE_END", data: { room_id: 101, timestamp: 110 } });
    expect(f.connection.status.broadcast).toBe("offline");
    await f.connection.disconnect();
    socket.receive(5, { cmd: "LIVE_OPEN_PLATFORM_LIVE_START", data: { room_id: 101, timestamp: 120 } });
    expect(f.connection.status.connection).toBe("disconnected"); expect(f.connection.status.broadcast).toBe("unknown");
  });
  it("reconnects with a fresh official interaction and requires another on-air confirmation", async () => {
    vi.useFakeTimers();
    const f = fixture(), connecting = f.connection.connect(credentials), first = await f.authenticate(); await connecting;
    first.receive(5, { cmd: "LIVE_OPEN_PLATFORM_LIVE_START", data: { room_id: 101 } }); first.close();
    expect(f.connection.status.connection).toBe("reconnecting"); expect(f.connection.status.broadcast).toBe("unknown");
    await vi.advanceTimersByTimeAsync(1000); const second = await f.authenticate();
    expect(f.fetcher.mock.calls.filter(([url]) => String(url).endsWith("/start"))).toHaveLength(2);
    expect(f.connection.status.connection).toBe("connected"); expect(f.connection.status.broadcast).toBe("unknown");
    const sent = first.sent; first.open(); expect(first.sent).toBe(sent);
    first.receive(5, { cmd: "LIVE_OPEN_PLATFORM_LIVE_START", data: { room_id: 101 } }); expect(f.connection.status.broadcast).toBe("unknown");
    second.receive(5, { cmd: "LIVE_OPEN_PLATFORM_LIVE_START", data: { room_id: 101, timestamp: 200 } }); expect(f.connection.status.broadcast).toBe("live");
  });
  it("detects a silent websocket and aborts a pending HTTP connect on stop", async () => {
    vi.useFakeTimers();
    const f = fixture(), connecting = f.connection.connect(credentials); await f.authenticate(); await connecting;
    await vi.advanceTimersByTimeAsync(60_000); expect(f.connection.status.connection).toBe("reconnecting");
    await f.connection.disconnect();
    let aborted = false;
    const pending = new BilibiliConnection(async (_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => { aborted = true; reject(init.signal?.reason); }, { once: true });
    })); instances.push(pending);
    const attempt = pending.connect(credentials); const result = expect(attempt).rejects.toBeDefined();
    await vi.advanceTimersByTimeAsync(0); pending.cancelPending(); await result;
    expect(aborted).toBe(true); await pending.disconnect(); expect(pending.status.connection).toBe("disconnected");
  });
  it("stops immediately when websocket authentication is still pending", async () => {
    const f = fixture(), attempt = f.connection.connect(credentials);
    const rejected = expect(attempt).rejects.toThrow("取消");
    await vi.waitFor(() => expect(f.sockets).toHaveLength(1));
    f.sockets[0]!.open(); f.connection.cancelPending(); await rejected;
    await f.connection.disconnect(); expect(f.connection.status.connection).toBe("disconnected");
  });
  it("does not retry a permanent developer permission failure", async () => {
    vi.useFakeTimers();
    const f = fixture(), attempt = f.connection.connect(credentials), socket = await f.authenticate(); await attempt;
    const failed = vi.fn(); f.connection.onFailure = failed;
    f.fetcher.mockImplementation(async input => new Response(JSON.stringify(String(input).endsWith("/end") ? { code: 0 } : { code: 4008 })));
    socket.close(); await vi.advanceTimersByTimeAsync(1000);
    expect(f.connection.status.connection).toBe("error"); expect(failed).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(120000); expect(failed).toHaveBeenCalledOnce();
  });
});
