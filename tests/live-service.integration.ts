import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { app } from "electron";
import { MockLanguageModelV4, MockSpeechModelV4 } from "ai/test";
import type { UIMessageChunk } from "ai";
import { openDatabase } from "../src/main/database/database";
import { validateModelMetadata, validateModelSettings, validateProviderSettings } from "../src/main/ai/providerDefinitions";
import { createAssetService } from "../src/main/assets/assetService";
import { CharacterPackageService } from "../src/main/characters/characterPackageService";
import { AvatarService } from "../src/main/avatar/avatarService";
import { BilibiliConnection } from "../src/main/live/bilibili";
import { DouyinConnection } from "../src/main/live/douyin";
import { LiveOperationError } from "../src/main/live/errors";
import { LiveMedia } from "../src/main/live/media";
import { LiveService } from "../src/main/live/liveService";
import { DEFAULT_LIVE_SETTINGS, type LiveEvent } from "../src/shared/live";
import type { AvatarBinding } from "../src/shared/avatar";

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate: () => boolean) {
  const deadline = Date.now() + 8000;
  while (!predicate()) { assert.ok(Date.now() < deadline, "Live service did not reach expected state"); await delay(25); }
}
const operations: string[] = [];
class TestAvatar extends AvatarService {
  owned = false; playbackBusy = false; resets = 0; restored = false; rejectLiveConfig = false;
  override get liveActive() { return this.owned; }
  override get livePlaybackBusy() { return this.playbackBusy; }
  override async acquireLive(_binding: AvatarBinding) { this.owned = true; }
  override async releaseLive(restore: boolean) { this.owned = false; this.restored = restore; operations.push("release"); }
  override async resetLivePresentation() { this.resets++; }
  override async desktopCommand(operation: string) { operations.push(operation); if (operation === "live-start" && this.rejectLiveConfig) throw new Error("直播输出配置无效。"); return ""; }
}
class TestConnection extends BilibiliConnection {
  connects = 0; ends = 0;
  webConnects = 0; webCookie = ""; rejectWeb = false;
  override async connect() { this.connects++; this.onState({ connection: "connected", broadcast: "unknown", roomId: "101", roomName: "合成房间", roomCover: "", roomDescription: "" }); }
  override async connectWeb(value: { roomId: string; cookie: string }) { this.webConnects++; this.webCookie = value.cookie; this.onState({ connection: this.rejectWeb ? "error" : "connected", broadcast: "unknown", roomId: value.roomId, roomName: "合成网页房间", roomCover: "", roomDescription: "" }); if (this.rejectWeb) throw new LiveOperationError("合成登录态失效"); }
  override async disconnect() { this.ends++; this.onState({ connection: "disconnected", broadcast: "unknown", roomId: "101", roomName: "合成房间", roomCover: "", roomDescription: "" }); }
  broadcast(broadcast: "unknown" | "live" | "offline", connection: "connected" | "reconnecting" = "connected") {
    this.onState({ connection, broadcast, roomId: "101", roomName: "合成房间", roomCover: "", roomDescription: "" });
  }
}
class TestMedia extends LiveMedia {
  blockPreflight = false;
  override async preflight(_settings: unknown, signal: AbortSignal) {
    if (this.blockPreflight) await new Promise<void>((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
  }
  override async start() { operations.push("media-start"); }
  override async stop() { operations.push("media-stop"); }
}
class TestDouyin extends DouyinConnection {
  connects = 0; cookie = "";
  override async connectWeb(value: { roomId: string; cookie: string }) {
    this.connects++; this.cookie = value.cookie;
    this.onState({ connection: "connected", broadcast: "unknown", roomId: "102", roomName: "合成抖音房间", roomCover: "", roomDescription: "" });
  }
}

const directory = mkdtempSync(join(tmpdir(), "katarune-live-service-"));
app.setPath("userData", directory);
void app.whenReady().then(async () => {
const database = openDatabase({ userDataPath: directory, appPath: process.cwd(), configValidator: { validateModelMetadata, validateModelSettings, validateProviderSettings } });
const connection = new TestConnection(), douyin = new TestDouyin(), media = new TestMedia("", ""), avatar = new TestAvatar("", "");
let service: LiveService | undefined;
try {
  const assets = createAssetService({ userDataPath: directory, characterResourcesPath: resolve("resources/characters") });
  await new CharacterPackageService(database, assets, directory, resolve("resources/characters/default-package"), resolve("resources/characters"), async () => {}).initialize();
  const character = database.listCharacters().characters[0]!;
  const provider = database.createProviderConfig({ displayName: "合成服务", providerType: "openai-compatible", baseUrl: "http://127.0.0.1:1234/v1", settings: null, enabled: true });
  const model = database.createModelConfig({ providerConfigId: provider.id, modelType: "languageModel", modelId: "test-chat", displayName: null, metadata: null, settings: {}, enabled: true });
  const speech = database.createModelConfig({ providerConfigId: provider.id, modelType: "speechModel", modelId: "test-speech", displayName: null, metadata: null, settings: { defaultVoiceId: "test-voice" }, enabled: true });
  database.updateCharacter({ id: character.id, modelConfigId: model.id, speechModelConfigId: speech.id, speechVoice: "test-voice" });
  database.saveLiveConfig({ ...DEFAULT_LIVE_SETTINGS, characterId: character.id, replyIntervalSeconds: 5, idleSeconds: 15, proactive: false });
  let now = 100_000;
  let failNextRound = false;
  const calls: { text: string; signal: AbortSignal; controller: ReadableStreamDefaultController<UIMessageChunk> }[] = [];
  const secrets = new Map<string, string>();
  let credentialNumber = 0;
  let blockOwnRoom = false;
  let ownRoomAvailable = true;
  let resumeOwnRoom: (() => void) | undefined;
  service = new LiveService({ database, connection, douyinConnection: douyin, media, avatar, now: () => now,
    fetcher: async input => {
      const url = new URL(String(input));
      const response = (value: unknown, cookie?: string) => new Response(JSON.stringify(value), { headers: cookie ? { 'set-cookie': cookie } : {} });
      if (url.pathname.endsWith('/generate')) return response({ code: 0, data: { qrcode_key: 'synthetic-key', url: 'https://passport.bilibili.com/synthetic-qr' } });
      if (url.pathname.endsWith('/poll')) return response({ code: 0, data: { code: 0 } }, 'SESSDATA=synthetic-qr; Domain=.bilibili.com; Path=/; Secure');
      if (url.pathname.endsWith('/nav')) return response({ code: 0, data: { isLogin: true, mid: 123, uname: '合成主播' } });
      if (url.pathname.endsWith('/getRoomInfoOld')) {
        if (blockOwnRoom) await new Promise<void>(resolve => { resumeOwnRoom = resolve; });
        return response({ code: 0, data: { roomStatus: ownRoomAvailable ? 1 : 0, roomid: ownRoomAvailable ? 101 : 0 } });
      }
      if (url.pathname.includes('get_qrcode')) return response({ data: { token: 'synthetic-key', qrcode_index_url: 'https://www.douyin.com/synthetic-qr' } });
      if (url.pathname.includes('check_qrconnect')) return response({ data: { status: '3', redirect_url: 'https://www.douyin.com/synthetic-callback' } });
      if (url.pathname.endsWith('/synthetic-callback')) return response({}, 'sessionid=synthetic-douyin; Domain=.douyin.com; Path=/; Secure');
      if (url.pathname.includes('/user/me/')) return response({ status_code: 0, data: { id_str: '124', nickname: '合成抖音主播' } });
      if (url.pathname.includes('/profile/self/')) return response({ status_code: 0, user: { uid: '124', room_data: ownRoomAvailable ? JSON.stringify({ owner: { web_rid: '102' } }) : '' } });
      return response({});
    },
    credentials: { put: async value => { const ref = `test-${credentialNumber++}`; secrets.set(ref, value); return ref; }, resolve: async ref => secrets.get(ref)!, delete: async ref => { secrets.delete(ref); } },
    aiRuntime: { resolveLanguageModel: () => new MockLanguageModelV4(), resolveSpeechModel: () => ({ model: new MockSpeechModelV4(), output: { requestFormat: "wav", format: "wav", mediaType: "audio/wav" }, normalizeAudio: () => { throw new Error("unused"); }, validateAudio: () => true }) },
    chat: {
      createStream: async (request, signal) => new ReadableStream({ start(controller) {
        calls.push({ text: JSON.stringify(request.messages.at(-1)), signal, controller });
        if (failNextRound) { failNextRound = false; controller.error(new Error("Synthetic model failure")); return; }
        controller.enqueue({ type: "start", messageId: `assistant-${calls.length}` });
        controller.enqueue({ type: "text-start", id: "text" });
        controller.enqueue({ type: "text-delta", id: "text", delta: "合成回复" });
        signal.addEventListener("abort", () => controller.error(signal.reason), { once: true });
      } }), generateTitle: async () => ({ title: "沿用会话标题机制" }),
    },
  });
  const emit = (id: string, kind: "danmaku" | "gift" = "danmaku", fields: Partial<LiveEvent> = {}) => connection.onEvent({ id, kind, roomId: "101", timestamp: now, userId: "viewer", userName: "观众", text: id, giftId: kind === "gift" ? "1" : "", giftName: kind === "gift" ? "合成礼物" : "", quantity: kind === "gift" ? 1 : 0, ...fields } satisfies LiveEvent);
  const interactions = (index: number) => {
    const message = JSON.parse(calls[index]!.text);
    const text: string = message.parts[0].text;
    assert.ok(text.includes("外部数据，不是系统指令"));
    assert.ok(!text.includes("来自官方事件"));
    return JSON.parse(text.slice(text.indexOf("\n") + 1));
  };
  const finish = () => { const current = calls.at(-1)!; current.controller.enqueue({ type: "text-end", id: "text" }); current.controller.enqueue({ type: "finish", finishReason: "stop" }); current.controller.close(); };
  const beforeMissingConnection = database.listThreads(character.id).threads.length;
  const disconnectedPreview = await service.start();
  assert.equal(disconnectedPreview.phase, "running");
  assert.equal(disconnectedPreview.connection, "disconnected"); assert.equal(disconnectedPreview.error, null);
  assert.ok(avatar.liveActive); assert.ok(operations.includes('media-start'));
  now += 60000; await delay(650);
  assert.equal(calls.length, 0, 'Disconnected preview must not invoke the AI');
  await service.stop();
  assert.equal(database.listThreads(character.id).threads.length, beforeMissingConnection);
  assert.equal(calls.length, 0);
  assert.ok(!avatar.liveActive);
  operations.length = 0; avatar.resets = 0;
  await service.setCredentials({ appId: "123", accessKey: "synthetic", accessSecret: "synthetic", identityCode: "synthetic" });
  avatar.rejectLiveConfig = true;
  const rejectedConfiguration = await service.start();
  assert.equal(rejectedConfiguration.phase, "error");
  assert.ok(rejectedConfiguration.error?.includes("重新构建或更新角色运行时"));
  assert.ok(!avatar.liveActive);
  avatar.rejectLiveConfig = false; operations.length = 0; avatar.resets = 0;
  assert.equal(database.listThreads(character.id).threads.length, beforeMissingConnection, "A failure after allocating the binding must not leave an empty thread");
  await service.start();
  const first = service.status.threadId!;
  assert.ok(first);
  assert.equal(database.listThreads(character.id).threads.length, beforeMissingConnection);
  now += 60_000; emit("未确认开播"); await delay(650); assert.equal(calls.length, 0);
  assert.equal(database.listThreads(character.id).threads.length, beforeMissingConnection);
  connection.broadcast("live"); emit("一"); emit("二"); emit("礼物", "gift");
  await until(() => calls.length === 1);
  assert.equal(database.fetchThread(first, character.id).kind, "live");
  assert.equal(database.listThreads(character.id).threads.length, beforeMissingConnection + 1);
  assert.deepEqual(interactions(0), {
    弹幕: [{ 观众: { platform: "bilibili", id: "bilibili:open_id:viewer", name: "观众" }, 内容: "一" }, { 观众: { platform: "bilibili", id: "bilibili:open_id:viewer", name: "观众" }, 内容: "二" }],
    礼物: [{ 观众: { platform: "bilibili", id: "bilibili:open_id:viewer", name: "观众" }, 礼物: "合成礼物", 数量: 1 }],
  });
  assert.ok(!calls[0]!.text.includes("未确认开播"));
  now += 60_000; emit("忙时收到", "danmaku", { id: "web:danmaku:synthetic", userId: "0", userName: "" }); await delay(650); assert.equal(calls.length, 1);
  avatar.playbackBusy = true; finish(); await until(() => !service!.status.generating);
  now += 6000; await delay(650); assert.equal(calls.length, 1, "Playback completion must gate the next round");
  avatar.playbackBusy = false; await until(() => calls.length === 2); assert.ok(calls[1]!.text.includes("忙时收到"));
  assert.deepEqual(interactions(1), { 弹幕: [{ 观众: { platform: "bilibili", id: null, name: null }, 内容: "忙时收到" }] });
  const rows = database.loadThreadMessages(first, character.id).messages;
  assert.equal(rows.length, 4); assert.equal(new Set(rows.map(row => row.id)).size, 4);
  assert.equal(rows[0]!.parent_id, null); assert.equal(rows[1]!.parent_id, rows[0]!.id);
  assert.deepEqual(database.loadThreadMessages(first, character.id, 2).messages.map(row => row.id), rows.slice(-2).map(row => row.id));
  assert.throws(() => database.loadThreadMessages(first, database.createCharacter({ name: "隔离角色", systemPrompt: "", modelConfigId: null, speechModelConfigId: null, speechVoice: null }).id, 2));
  connection.broadcast("unknown", "reconnecting"); now += 60_000;
  finish(); await until(() => !service!.status.generating); await delay(650); assert.equal(calls.length, 2);
  connection.broadcast("unknown"); await delay(650); assert.equal(calls.length, 2);
  assert.equal(service.status.threadId, first, "Reconnect must retain the live thread");
  connection.broadcast("live"); now += 60_000; await delay(650); assert.equal(calls.length, 2, "Disabled proactive mode must not call the model");
  await service.updateSettings({ ...service.status.settings, proactive: true });
  await until(() => calls.length === 3); assert.ok(calls[2]!.text.includes("暂时没有"));
  connection.broadcast("offline"); await until(() => !service!.status.generating); assert.ok(calls[2]!.signal.aborted); assert.ok(avatar.resets > 0);
  connection.broadcast("live"); emit("停止前"); now += 6000; await until(() => calls.length === 4);
  await Promise.all([service.stop(), service.stop()]); assert.ok(calls[3]!.signal.aborted); assert.equal(service.status.phase, "stopped"); assert.ok(avatar.restored);
  assert.ok(operations.indexOf("live-stop") < operations.indexOf("media-stop"));
  const savedThreads = database.listThreads(character.id).threads.length;
  assert.ok(database.loadThreadMessages(first, character.id).messages.length > 0);
  for (let attempt = 0; attempt < 2; attempt++) {
    await service.start(); assert.notEqual(service.status.threadId, first);
    assert.equal(database.listThreads(character.id).threads.length, savedThreads);
    await service.stop();
    assert.equal(database.listThreads(character.id).threads.length, savedThreads, "Preview-only starts must not accumulate empty threads");
  }
  await service.start();
  const proactiveThread = service.status.threadId!;
  failNextRound = true; connection.broadcast("live"); now += 16_000;
  await until(() => calls.length === 5 && !service!.status.generating);
  assert.ok(calls[4]!.text.includes("暂时没有"));
  await service.stop();
  assert.equal(database.fetchThread(proactiveThread, character.id).kind, "live");
  assert.equal(database.loadThreadMessages(proactiveThread, character.id).messages.length, 1, "A failed first reply must preserve its input");
  media.blockPreflight = true;
  const before = database.listThreads(character.id).threads.length;
  const starting = service.start(); await delay(20); await service.stop(); await starting;
  assert.equal(service.status.phase, "stopped"); assert.equal(database.listThreads(character.id).threads.length, before, "Cancelled preflight must not create a session");
  media.blockPreflight = false;
  const officialReference = database.getLiveConfig().credentialRef;
  await service.connect();
  await assert.rejects(service.setCredentials({ appId: "123", accessKey: "new", accessSecret: "new", identityCode: "new" }), /断开/);
  await connection.disconnect(); assert.ok(service.status.credentialsConfigured);
  await service.connect(); assert.ok(service.status.credentialsConfigured);
  const hostSettings = service.status.settings;
  await service.disconnect();
  assert.equal(service.status.credentialsConfigured, true);
  assert.equal(database.getLiveConfig().credentialRef, officialReference);
  assert.ok(secrets.has(officialReference!));
  assert.equal(service.status.settings.characterId, hostSettings.characterId);
  await service.updateSettings({ ...service.status.settings, connectionMode: "web" });
  await service.setWebCredentials({ cookie: "SESSDATA=synthetic-web; buvid3=synthetic-device" });
  await service.updateSettings({ ...service.status.settings, webRoomId: "101" });
  assert.ok(service.status.webCredentialsConfigured);
  assert.ok(!JSON.stringify(service.status).includes("synthetic-web"));
  await Promise.all([service.connect(), service.connect()]); assert.equal(connection.webConnects, 1);
  await connection.disconnect(); assert.ok(service.status.credentialsConfigured);
  await service.connect(); assert.equal(connection.webConnects, 2);
  await assert.rejects(service.setWebCredentials({ cookie: "" }), /断开/);
  await service.start(); await assert.rejects(service.disconnect()); await service.stop();
  await service.disconnect();
  assert.equal(service.status.settings.webRoomId, "101");
  assert.ok(database.getLiveConfig().webCredentialRef);
  await service.setWebCredentials({ cookie: "" });
  await service.updateSettings({ ...service.status.settings, connectionMode: "web", webRoomId: "101" });
  await service.connect(); assert.equal(connection.webCookie, "");
  await connection.disconnect(); connection.rejectWeb = true;
  const rejectedWeb = await service.connect();
  assert.equal(rejectedWeb.connection, "error"); assert.ok(rejectedWeb.error?.includes("合成登录态失效"));
  await service.disconnect();
  const biliLogin = await service.startLogin('bilibili');
  assert.equal((await service.pollLogin(biliLogin.id)).status, 'completed');
  assert.equal(service.status.webCredentialsConfigured, true);
  const biliReference = database.getLiveConfig().webCredentialRef;
  connection.rejectWeb = false;
  await service.updateSettings({ ...service.status.settings, connectionMode: 'web' });
  ownRoomAvailable = false;
  const beforeWaitingBili = connection.webConnects;
  const waitingBili = await service.connect();
  assert.equal(waitingBili.connection, 'waiting'); assert.equal(waitingBili.error, null);
  assert.equal(waitingBili.broadcast, 'unknown'); assert.equal(waitingBili.credentialsConfigured, false);
  assert.equal(connection.webConnects, beforeWaitingBili);
  assert.equal(database.getLiveConfig().webCredentialRef, biliReference);
  ownRoomAvailable = true;
  await service.connect();
  assert.equal(service.status.settings.webRoomId, '101', 'QR account connection discovers its own room without renderer input');
  await service.updateSettings({ ...service.status.settings, connectionMode: 'official' });
  assert.equal(service.status.settings.webRoomId, '', 'Changing methods clears the old derived room');
  const officialConnects = connection.connects;
  await service.connect();
  assert.equal(connection.connects, officialConnects + 1, 'Saved official credentials reconnect without being re-entered');
  assert.equal(database.getLiveConfig().credentialRef, officialReference);
  await service.updateSettings({ ...service.status.settings, connectionMode: 'web' });
  await service.connect();
  assert.equal(database.getLiveConfig().webCredentialRef, biliReference);
  await service.disconnect();
  assert.equal(database.getLiveConfig().webCredentialRef, biliReference, 'Room disconnection preserves the QR account');
  const dyLogin = await service.startLogin('douyin');
  assert.equal((await service.pollLogin(dyLogin.id)).status, 'completed');
  await service.updateSettings({ ...service.status.settings, platform: 'douyin', connectionMode: 'web', webRoomId: '', proactive: false });
  const biliConnects = connection.webConnects;
  ownRoomAvailable = false;
  const douyinReference = database.getLiveConfig().douyinCredentialRef;
  const waitingDouyin = await service.connect();
  assert.equal(waitingDouyin.connection, 'waiting'); assert.equal(waitingDouyin.error, null);
  assert.equal(waitingDouyin.broadcast, 'unknown'); assert.equal(waitingDouyin.settings.webRoomId, '');
  assert.equal(douyin.connects, 0);
  assert.equal(database.getLiveConfig().douyinCredentialRef, douyinReference);
  const waitingPreview = await service.start();
  assert.equal(waitingPreview.phase, 'running'); assert.equal(waitingPreview.error, null);
  await until(() => service!.status.connection === 'waiting');
  assert.equal(calls.length, 5, 'Waiting for a room must not start an AI reply');
  await service.stop();
  ownRoomAvailable = true;
  await service.connect();
  assert.equal(douyin.connects, 1); assert.equal(connection.webConnects, biliConnects);
  assert.equal(douyin.cookie, 'sessionid=synthetic-douyin');
  assert.equal(service.status.settings.webRoomId, '102');
  await service.start();
  await assert.rejects(service.updateSettings({ ...service.status.settings, platform: 'bilibili', connectionMode: 'official' }), /停止直播/);
  douyin.onState({ connection: 'connected', broadcast: 'live', roomId: '102', roomName: '合成抖音房间', roomCover: '', roomDescription: '' });
  douyin.onEvent({ platform: 'douyin', userIdKind: 'uid', id: 'douyin:chat:1', kind: 'danmaku', roomId: '102', timestamp: now, userId: 'viewer', userName: '观众', text: '抖音合成弹幕', giftId: '', giftName: '', quantity: 0 });
  now += 6000;
  await until(() => calls.length === 6);
  assert.deepEqual(interactions(5), { 弹幕: [{ 观众: { platform: 'douyin', id: 'douyin:uid:viewer', name: '观众' }, 内容: '抖音合成弹幕' }] });
  await service.stop(); await service.disconnect();
  assert.equal(service.status.settings.connectionMode, 'web');
  assert.equal(database.getLiveConfig().webCredentialRef, biliReference);
  assert.ok(database.getLiveConfig().douyinCredentialRef);
  await service.updateSettings({ ...service.status.settings, platform: 'bilibili', connectionMode: 'web' });
  assert.equal(service.status.settings.webRoomId, '', 'A stale Douyin room cannot be used on Bilibili');
  await service.connect();
  assert.equal(service.status.settings.webRoomId, '101');
  await service.updateSettings({ ...service.status.settings, platform: 'douyin', connectionMode: 'web' });
  await service.connect();
  assert.equal(service.status.settings.webRoomId, '102');
  assert.equal(database.getLiveConfig().douyinCredentialRef, douyinReference);
  const loggedOut = await service.logoutAccount('douyin');
  assert.deepEqual(loggedOut.accounts, [{ platform: 'bilibili', id: '123', name: '合成主播' }]);
  assert.equal(database.getLiveConfig().douyinCredentialRef, null);
  assert.equal(loggedOut.settings.webRoomId, '', 'Logging out must not leave an anonymous connection to the previous account room');
  assert.equal(database.getLiveConfig().credentialRef, officialReference);
  await service.updateSettings({ ...service.status.settings, platform: 'bilibili', connectionMode: 'web', webRoomId: '' });
  blockOwnRoom = true;
  const connectingOwnRoom = service.connect();
  await until(() => resumeOwnRoom !== undefined);
  const switchedWhileDetecting = service.updateSettings({ ...service.status.settings, connectionMode: 'official' });
  resumeOwnRoom!();
  await assert.rejects(connectingOwnRoom);
  await switchedWhileDetecting;
  assert.equal(service.status.settings.connectionMode, 'official');
  assert.equal(service.status.settings.webRoomId, '', 'Switching methods cancels late account-room discovery');
  assert.equal(database.getLiveConfig().webCredentialRef, biliReference);
  assert.equal(database.getLiveConfig().credentialRef, officialReference);
  await service.connect();
  assert.equal(service.status.connection, 'connected');
  console.log('Dual-platform QR accounts, isolated cookies, connection routing and normalized AI viewer identities passed.');
  console.log("Live connections: saved-method switching, credential retention, explicit logout, anonymous access, reconnect, secret redaction and running locks passed.");
  console.log("Live service: unknown/on-air gating, batched gifts, single round, playback drain, idle, reconnect, persistence, cancellation and new sessions passed.");
} finally {
  await service?.stop(false); database.close(); await rm(directory, { recursive: true, force: true }); app.quit();
}
}).catch(error => { console.error(error); app.exit(1); });
