import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import QRCode from "qrcode";
import { app, BrowserWindow, ipcMain, protocol, safeStorage } from "electron";
import { createCredentialStore } from "../src/main/security/credentialStore";
import { McpService } from "../src/main/mcp/mcpService";
import { registerMcpHandlers } from "../src/main/ipc/mcpHandlers";
import { openDatabase } from "../src/main/database/database";
import { createDiaryService } from "../src/main/memory/diaryService";
import { registerMemoryHandlers } from "../src/main/ipc/memoryHandlers";
import { createAssetService } from "../src/main/assets/assetService";
import { assetSchema, referenceChatAttachmentRequestSchema, importChatAttachmentRequestSchema, initializeThreadRequestSchema } from "../src/shared/ipc";
import { AGENT_TOOL_CHANNELS, agentAccessRequestSchema, agentCharacterRequestSchema, agentModeRequestSchema } from "../src/shared/agentTools";
import { DEFAULT_LIVE_SETTINGS, LIVE_CHANNELS, LIVE_LOGIN_CHANNELS, livePlatformSchema, liveLoginIdSchema, liveSettingsSchema, liveCredentialsSchema, liveWebCredentialsSchema } from "../src/shared/live";
import { Mp4Preview } from "../src/main/live/mp4Preview";
import { registerWindowThemeHandler } from "../src/main/windowTheme";
import { validateModelMetadata, validateModelSettings, validateProviderSettings } from "../src/main/ai/providerDefinitions";
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
} from "ai";

const projectRoot = process.cwd();
const runDirectory = process.env.KATARUNE_UI_TEST_RUN_DIR;
assert.ok(runDirectory, "KATARUNE_UI_TEST_RUN_DIR is required");
const userDataPath = join(runDirectory, "user-data");
const sessionDataPath = join(runDirectory, "session-data");

protocol.registerSchemesAsPrivileged([
  {
    scheme: "katarune-asset",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);

mkdirSync(userDataPath, { recursive: true });
mkdirSync(sessionDataPath, { recursive: true });
app.setPath("userData", userDataPath);
app.setPath("sessionData", sessionDataPath);
app.commandLine.appendSwitch("disable-gpu");
app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
app.commandLine.appendSwitch('use-fake-device-for-media-stream');

const now = new Date("2026-07-19T00:00:00.000Z");
const providerId = "d3867f4b-e85f-4ff4-ac2b-974dc39ad832";
const modelId = "e76076e7-73a8-42c2-92d7-f9fa8d44f5eb";
const googleProviderId = "00000000-0000-4000-8000-000000000010";
const googleSpeechModelId = "00000000-0000-4000-8000-000000000011";
const manualSpeechModelId = "00000000-0000-4000-8000-000000000012";
const characterId = "00000000-0000-4000-8000-000000000001";
let emptyConfigMode = false;
let failModelSettingsRead = false;
let includeGoogleSpeechFixture = false;
let googleVoiceCatalogRefreshed = false;
let ordinaryPrepareCount = 0;
let realtimePrepareCount = 0;
let realtimeFrameCount = 0;
let realtimeText = '';
let testingRealtime = false;
let createdProviderRequest = null;
let failProviderSave = false;
let automaticDiscoveryRequests = 0;
let createdProvider = null;
let replacedCredentialRequest = null;
let createdModelRequest = null;
let createdModel = null;
let updatedModelRequest = null;
let modelEnabled = true;
let appSettings = { defaultLanguageModelConfigId: null, defaultSpeechModelConfigId: null, defaultSpeechVoice: null, defaultAsrModel: "sensevoice-small-int8" };
let updatedCharacterRequest = null;
let createdCharacterCount = 0;
let createdCharacterRequest = null;
let deletedCharacterRequest = null;
let renamedThreadRequest = null;
let generatedThreadTitleRequest = null;
let statusThreadRequest = null;
let deletedThreadRequest = null;
const importedAttachmentRequests = [];
const importedAttachmentIds = [
  "77777777-7777-4777-8777-777777777777",
  "88888888-8888-4888-8888-888888888888",
  "99999999-9999-4999-8999-999999999999",
];
const releasedAttachmentIds = [];
const appendedMessageRequests = [];
let changeLiveFixture;
let liveWebCredentialWrites = 0;
let liveQrFailure = false;
let liveHoldScanned = false;
let liveLoginRequests = 0;
let liveConnectionRequests = 0;
let liveDisconnectRequests = 0;
let holdLiveConnect = false;
let releaseLiveConnect;
let liveQrVerification = false;
let liveVerificationOpened = 0;
let liveRoomMissing = false;
const livePreviewAcks = [];
let character = {
  id: characterId,
  name: "测试角色 A",
  packageId: "builtin:default",
  packagePortraitAssetId: "00000000-0000-4000-8000-000000000002",
  packageThumbnailAssetId: "00000000-0000-4000-8000-000000000004",
  portraitAssetId: "00000000-0000-4000-8000-000000000002",
  modelConfigId: modelId,
  speechModelConfigId: null,
  speechVoice: null,
  useDefaultSpeechModel: false, useDefaultSpeechVoice: false,
  systemPrompt: "你是用于界面验证的测试角色 A。",
  createdAt: now,
  updatedAt: now,
};
const secondCharacter = {
  id: "00000000-0000-4000-8000-000000000003",
  name: "测试角色 B",
  packageId: "builtin:default",
  packagePortraitAssetId: "00000000-0000-4000-8000-000000000002",
  packageThumbnailAssetId: "00000000-0000-4000-8000-000000000004",
  portraitAssetId: null,
  modelConfigId: null,
  speechModelConfigId: null,
  speechVoice: null,
  useDefaultSpeechModel: false, useDefaultSpeechVoice: false,
  systemPrompt: "你是用于界面验证的测试角色 B。",
  createdAt: now,
  updatedAt: now,
};
let characters = [character, secondCharacter];
let activeCharacterId = characterId;
const agentModes = new Map();
const chatAccessModes = new Map();
let failThreadInitialization = false;
const failedThreadInitializations = [];
const openedAgentWorkspaces = [];
let directoryApprovalResponses = 0;
let webApprovalResponses = 0;
let threads = [
  ...Array.from({ length: 18 }, (_, index) => ({
    remoteId: `test-thread-${index + 1}`,
    status: "regular",
    title: index === 0 ? "用于验证会话标题显示的测试会话" : `测试会话 ${index + 1}`,
    lastMessageAt: new Date(now.getTime() - index * 3_600_000),
    characterId,
  })),
  {
    remoteId: "archived-test-thread",
    status: "archived",
    title: "不应出现的归档会话",
    lastMessageAt: now,
    characterId,
  },
  {
    remoteId: "second-character-visible-thread",
    status: "regular",
    title: "只属于测试角色 B的会话",
    lastMessageAt: now,
    characterId: secondCharacter.id,
  },
];
const storedMessages = new Map();
let toolOnlyRequests = 0;
let memoryToolRequests = 0;
let activeChatStreamCount = 0;
let maximumConcurrentChatStreams = 0;
let maximumConcurrentChatCharacters = 0;
const activeChatStreamsByCharacter = new Map();
let releaseFirstChatStream;
let releaseCrossCharacterStream;
let avatarStatus = { phase: "stopped", binding: null, error: null };
const avatarChatRequests = [];
const avatarUserSubtitles = [];
const titleRequests = [];
let releaseAvatarOutput;
let canceledAvatarStreams = 0;
let pendingThreadListLoads = 0;
let completedThreadListLoads = 0;
let memoryDatabase;
let mcpService;

function silentWav(durationMs = 2_000) {
  const sampleRate = 8_000;
  const sampleCount = Math.ceil((sampleRate * durationMs) / 1_000);
  const dataLength = sampleCount * 2;
  const audio = new Uint8Array(44 + dataLength);
  const view = new DataView(audio.buffer);
  const writeText = (offset, value) =>
    audio.set(new TextEncoder().encode(value), offset);
  writeText(0, "RIFF");
  view.setUint32(4, audio.byteLength - 8, true);
  writeText(8, "WAVE");
  writeText(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeText(36, "data");
  view.setUint32(40, dataLength, true);
  return audio;
}

function messageKey(threadId, characterId) {
  return `${characterId}:${threadId}`;
}

const deliveredFiles = [];
function registerMockHandlers() {
  ipcMain.handle(AGENT_TOOL_CHANNELS.file, (_event, request) => {
    deliveredFiles.push(request);
    assert.equal(request.characterId, characterId);
    return { filename: 'report.txt', byteSize: 6, ...(request.action === 'preview' ? { text: '文件预览测试' } : {}) };
  });
  ipcMain.handle(AGENT_TOOL_CHANNELS.get, (_event, value) => {
    const request = agentAccessRequestSchema.parse(value);
    if (request.threadId !== undefined) assert.equal(threads.find(thread => thread.remoteId === request.threadId)?.characterId, request.characterId);
    return { mode: agentModes.get(request.threadId) ?? "request-approval", directories: [], nativeShellAvailable: true };
  });
  ipcMain.handle(AGENT_TOOL_CHANNELS.setMode, (_event, value) => {
    const request = agentModeRequestSchema.parse(value);
    assert.equal(threads.find(thread => thread.remoteId === request.threadId)?.characterId, request.characterId);
    agentModes.set(request.threadId, request.mode);
    return { mode: request.mode, directories: [], nativeShellAvailable: true };
  });
  ipcMain.handle(AGENT_TOOL_CHANNELS.openWorkspace, (_event, value) => {
    const request = agentCharacterRequestSchema.parse(value);
    assert.ok(characters.some(character => character.id === request.characterId));
    openedAgentWorkspaces.push(request.characterId);
  });
  protocol.handle('https', request => ['https://p3.douyinpic.com/synthetic-avatar.png', 'https://p3-webcast.douyinpic.com/synthetic-cover.png'].includes(request.url)
    ? new Response(readFileSync(join(projectRoot, 'resources', 'katarune-logo.png')), { headers: { 'content-type': 'image/png' } })
    : new Response(null, { status: 404 }));
  let live = { settings: { ...DEFAULT_LIVE_SETTINGS, characterId }, credentialsConfigured: false, officialCredentialsConfigured: false, webCredentialsConfigured: false, phase: "stopped", connection: "disconnected", broadcast: "unknown", roomId: "", roomName: "", threadId: null, runId: null, monitor: false, generating: false, revision: 0, events: [], error: null };
  const changeLive = next => { live = { ...live, ...next, revision: live.revision + 1 }; live.credentialsConfigured = live.settings.connectionMode === 'web' ? !!live.settings.webRoomId : live.officialCredentialsConfigured; live.webCredentialsConfigured = !!live.accounts?.some(account => account.platform === live.settings.platform); for (const window of BrowserWindow.getAllWindows()) window.webContents.send(LIVE_CHANNELS.changed, live); return live; };
  changeLiveFixture = changeLive;
  let login;
  let loginPolls = 0;
  ipcMain.handle(LIVE_LOGIN_CHANNELS.start, async (_event, value) => {
    liveLoginRequests++;
    const platform = livePlatformSchema.parse(value);
    loginPolls = 0;
    login = { id: randomUUID(), platform, status: liveQrFailure ? 'error' : 'waiting', qrImage: liveQrFailure ? '' : await QRCode.toDataURL(`https://${platform === 'bilibili' ? 'passport.bilibili.com' : 'www.douyin.com'}/synthetic-qr`), expiresAt: Date.now() + 180000, account: null, message: liveQrFailure ? '抖音暂时阻止了此次扫码登录（4031），请稍后刷新二维码重试。' : '请使用对应平台 App 扫码。' };
    return login;
  });
  ipcMain.handle(LIVE_LOGIN_CHANNELS.poll, (_event, value) => {
    assert.equal(liveLoginIdSchema.parse(value), login.id);
    if (login.status !== 'waiting' && login.status !== 'scanned' && login.status !== 'verification') return login;
    if (login.platform === 'douyin' && liveQrVerification && !liveVerificationOpened) return (login = { ...login, status: 'verification', message: '需要本人完成安全验证。' });
    if (++loginPolls === 1 || liveHoldScanned) return (login = { ...login, status: 'scanned', message: '已扫码，请在手机上确认登录。' });
    const account = { platform: login.platform, id: login.platform === 'bilibili' ? '123' : '9007199254740997', name: `${login.platform === 'bilibili' ? 'B站' : '抖音'}合成主播`, avatarUrl: 'https://p3.douyinpic.com/synthetic-avatar.png' };
    changeLive({ accounts: [...(live.accounts ?? []).filter(item => item.platform !== login.platform), account], webCredentialsConfigured: true });
    return (login = { ...login, status: 'completed', qrImage: '', account, message: '登录成功。' });
  });
  ipcMain.handle(LIVE_LOGIN_CHANNELS.cancel, (_event, value) => { if (login?.id === liveLoginIdSchema.parse(value)) login = { ...login, status: 'cancelled', qrImage: '', message: '登录已取消。' }; });
  ipcMain.handle(LIVE_LOGIN_CHANNELS.verification, (_event, value) => { assert.equal(liveLoginIdSchema.parse(value), login.id); liveVerificationOpened++; });
  ipcMain.handle(LIVE_LOGIN_CHANNELS.logout, (_event, value) => changeLive({ accounts: (live.accounts ?? []).filter(account => account.platform !== livePlatformSchema.parse(value)), settings: { ...live.settings, webRoomId: '' }, connection: 'disconnected', broadcast: 'unknown', webCredentialsConfigured: false }));
  ipcMain.handle(LIVE_CHANNELS.state, () => live);
  ipcMain.handle(LIVE_CHANNELS.settings, (_event, value) => {
    const settings=liveSettingsSchema.parse(value);
    const switching = settings.platform !== live.settings.platform || settings.connectionMode !== live.settings.connectionMode;
    if (switching) settings.webRoomId = '';
    return changeLive({settings,...(switching?{connection:'disconnected',broadcast:'unknown',roomId:'',roomName:'',roomCover:'',roomDescription:'',events:[]}:{})});
  });
  ipcMain.handle(LIVE_CHANNELS.credentials, (_event, value) => { liveCredentialsSchema.parse(value); return changeLive({ officialCredentialsConfigured: true }); });
  ipcMain.handle(LIVE_CHANNELS.webCredentials, (_event, value) => { liveWebCredentialWrites++; return changeLive({ webCredentialsConfigured: !!liveWebCredentialsSchema.parse(value).cookie }); });
  ipcMain.handle(LIVE_CHANNELS.connect, async () => {
    liveConnectionRequests++;
    if (holdLiveConnect) await new Promise(resolve => { releaseLiveConnect = resolve; });
    if (live.connection === 'connected') return live;
    if (liveRoomMissing && live.settings.connectionMode === 'web') return changeLive({ connection: 'waiting', broadcast: 'unknown', roomId: '', roomName: '', roomDescription: '', error: null });
    if (live.settings.connectionMode === 'web' && !live.settings.webRoomId && live.accounts?.some(account => account.platform === live.settings.platform)) changeLive({ settings: { ...live.settings, webRoomId: live.settings.platform === 'douyin' ? '102' : '101' } });
    if(!live.credentialsConfigured)throw new Error('Missing fixture connection config');
    return changeLive({connection:'connected',broadcast:live.settings.connectionMode === 'web' ? 'offline' : 'unknown',roomId:live.settings.webRoomId || '101',roomName:'合成直播间',roomCover:'',roomDescription:'<p>欢迎来到直播间</p><p>一起聊天<br>一起玩耍</p><script>bad()</script>'});
  });
  ipcMain.handle(LIVE_CHANNELS.disconnect, () => { liveDisconnectRequests++; return changeLive({connection:"disconnected",broadcast:"unknown",roomId:"",roomName:"",roomCover:"",roomDescription:"",events:[]}); });
  ipcMain.handle(LIVE_CHANNELS.start, () => changeLive({ phase: 'running', error: null }));
  ipcMain.handle(LIVE_CHANNELS.stop, () => changeLive({ phase: 'stopped', error: null }));
  ipcMain.handle(LIVE_CHANNELS.monitor, (_event, value) => changeLive({ monitor: value.enabled }));
  ipcMain.on(LIVE_CHANNELS.subscribePreview, (_event, value) => { if (typeof value === 'number') livePreviewAcks.push(value); });
  memoryDatabase = openDatabase({ userDataPath, appPath: projectRoot, configValidator: { validateModelMetadata, validateModelSettings, validateProviderSettings } });
  registerMemoryHandlers({ ...memoryDatabase, getAppState: () => ({ activeCharacter: characters.find(item => item.id === activeCharacterId) }) });
  ipcMain.handle('asr:prepare', () => { ordinaryPrepareCount++; return { status: 'success', text: '' }; });
  ipcMain.handle('asr:transcribe', (_event, request) => {
    assert.ok(request.samples instanceof Float32Array);
    assert.ok(request.samples.length > 0 && request.samples.length <= 480000);
    return { status: 'success', text: '这是离线语音输入。' };
  });
  ipcMain.on('asr:cancel', () => {});
  ipcMain.handle('asr:realtime', (_event, request) => {
    assert.deepEqual({ characterId: request.characterId, threadId: request.threadId }, avatarStatus.binding);
    realtimePrepareCount++; return { status: 'success', text: '' };
  });
  ipcMain.handle('asr:reset', () => ({ status: 'success', text: '' }));
  ipcMain.handle('asr:frame', (event, request) => {
    assert.equal(request.samples.length, 1600);
    realtimeFrameCount++;
    const text = realtimeText; realtimeText = '';
    if (text) event.sender.send('asr:progress', { requestId: request.requestId });
    return { status: 'success', text, complete: !!text, speech: false };
  });
  ipcMain.handle("avatar:status", () => avatarStatus);
  ipcMain.handle("avatar:start", (event, binding) => {
    avatarStatus = { phase: "ready", binding, error: null, voice: { desired: true, phase: "preparing", error: null } };
    event.sender.send("avatar:changed", avatarStatus); return avatarStatus;
  });
  ipcMain.handle("avatar:stop", (event) => {
    avatarStatus = { phase: "stopped", binding: null, error: null, voice: { desired: false, phase: "idle", error: null } };
    event.sender.send("avatar:changed", avatarStatus); return avatarStatus;
  });
  ipcMain.handle("avatar:voice-state", (event, request) => {
    if (avatarStatus.phase !== 'ready' || request.binding.threadId !== avatarStatus.binding.threadId) return;
    avatarStatus = { ...avatarStatus, voice: { desired: request.phase === 'error' ? false : avatarStatus.voice.desired,
      phase: request.phase, error: request.error } };
    event.sender.send('avatar:changed', avatarStatus);
  });
  ipcMain.handle("avatar:playback-control", () => {});
  ipcMain.handle("avatar:user-subtitle", (_event, request) => { avatarUserSubtitles.push(request); });
  ipcMain.handle("app:get-info", () => ({
    name: "Katarune",
    version: "0.1.0",
    platform: "win32",
    electronVersion: process.versions.electron,
    nodeVersion: process.versions.node,
  }));
  let appUpdateState = { status: "idle" };
  let updateChecks = 0;
  const publishUpdate = (event, state) => {
    appUpdateState = state;
    event.sender.send("app-update:changed", state);
  };
  ipcMain.handle("app-update:open", (event) => {
    if (appUpdateState.status === "idle") publishUpdate(event, { status: "latest" });
    return appUpdateState;
  });
  ipcMain.handle("app-update:check", (event) => {
    updateChecks += 1;
    if (updateChecks === 1) publishUpdate(event, { status: "check-failed" });
    else publishUpdate(event, { status: "available", version: "0.2.0" });
  });
  ipcMain.handle("app-update:apply", (event) => publishUpdate(event, { status: "installing", version: "0.2.0" }));
  ipcMain.handle("database:get-status", () => ({
    ready: true,
    journalMode: "wal",
    threadCount: 0,
    validationThreadId: "ui-smoke",
    validationThreadRestored: true,
  }));
  ipcMain.handle("ai:get-runtime-status", () => ({
    ready: true,
    configuredProviderCount: 1,
    modelCallsEnabled: true,
  }));
  ipcMain.handle("app-state:get", () => ({
    activeCharacter: characters.find((candidate) => candidate.id === activeCharacterId),
  }));
  ipcMain.handle("app-settings:get", () => appSettings);
  ipcMain.handle("app-settings:update", (_event, request) => {
    appSettings = { ...appSettings, ...request };
    return appSettings;
  });
  ipcMain.handle("app-state:set-active-character", (_event, request) => {
    activeCharacterId = request.characterId;
    return {
      activeCharacter: characters.find((candidate) => candidate.id === activeCharacterId),
    };
  });
  ipcMain.handle("threads:list", async (_event, request) => {
    pendingThreadListLoads += 1;
    try {
      await new Promise(resolve => setTimeout(resolve, 80));
      return { threads: threads.filter((thread) => thread.characterId === request.characterId) };
    } finally {
      pendingThreadListLoads -= 1;
      completedThreadListLoads += 1;
    }
  });
  ipcMain.handle("threads:initialize", (_event, value) => {
    const request = initializeThreadRequestSchema.parse(value);
    if (failThreadInitialization) {
      failedThreadInitializations.push(request);
      throw new Error("合成会话初始化失败");
    }
    if (!threads.some((thread) => thread.remoteId === request.threadId)) {
      agentModes.set(request.threadId, request.initialAccessMode ?? 'request-approval');
      threads = [
        {
          remoteId: request.threadId,
          status: "regular",
          title: "新对话",
          lastMessageAt: now,
          characterId: request.characterId,
        },
        ...threads,
      ];
    }
    return { remoteId: request.threadId };
  });
  ipcMain.handle("threads:fetch", (_event, request) => {
    const thread = threads.find(
      (candidate) =>
        candidate.remoteId === request.threadId &&
        candidate.characterId === request.characterId,
    );
    if (thread === undefined) throw new Error("Thread not found");
    return thread;
  });
  ipcMain.handle("threads:generate-title", (_event, request) => {
    titleRequests.push(request);
    generatedThreadTitleRequest = request;
    const title = `测试会话：${request.messages[0]?.text.slice(0, 12) ?? "新对话"}`;
    threads = threads.map((thread) =>
      thread.remoteId === request.threadId &&
      thread.characterId === request.characterId
        ? { ...thread, title }
        : thread,
    );
    return { title };
  });
  ipcMain.handle("threads:rename", (_event, request) => {
    renamedThreadRequest = request;
    threads = threads.map((thread) =>
      thread.remoteId === request.threadId &&
      thread.characterId === request.characterId
        ? { ...thread, title: request.title }
        : thread,
    );
    return { success: true };
  });
  ipcMain.handle("threads:set-status", (_event, request) => {
    statusThreadRequest = request;
    threads = threads.map((thread) =>
      thread.remoteId === request.threadId &&
      thread.characterId === request.characterId
        ? { ...thread, status: request.status }
        : thread,
    );
    return { success: true };
  });
  ipcMain.handle("threads:delete", (_event, request) => {
    deletedThreadRequest = request;
    threads = threads.filter(
      (thread) =>
        thread.remoteId !== request.threadId ||
        thread.characterId !== request.characterId,
    );
    return { success: true };
  });
  ipcMain.handle("thread-messages:load", (_event, request) => ({
    messages: storedMessages.get(messageKey(request.threadId, request.characterId)) ?? [],
  }));
  ipcMain.handle("thread-messages:append", (_event, request) => {
    appendedMessageRequests.push(request);
    const key = messageKey(request.threadId, request.characterId);
    const messages = storedMessages.get(key) ?? [];
    const nextMessages = messages.filter(
      (message) => message.id !== request.message.id,
    );
    nextMessages.push(request.message);
    storedMessages.set(key, nextMessages);
    threads = threads.map((thread) =>
      thread.remoteId === request.threadId &&
      thread.characterId === request.characterId
        ? { ...thread, lastMessageAt: new Date() }
        : thread,
    );
    return { success: true };
  });
  ipcMain.handle("chat-attachments:import", (_event, request) => {
    if (request.mediaType.startsWith('image/')) return createAssetService({ userDataPath, characterResourcesPath: join(userDataPath, 'unused') }).importChatAttachment(importChatAttachmentRequestSchema.parse(request), memoryDatabase);
    const id = importedAttachmentIds[importedAttachmentRequests.length];
    assert.ok(id, "Unexpected attachment import");
    importedAttachmentRequests.push(request);
    return {
      id,
      kind: "chat_attachment",
      status: "ready",
      mimeType: request.mediaType || "application/octet-stream",
      byteSize: request.data.byteLength,
      sha256: "d".repeat(64),
      originalName: request.name,
      createdAt: now,
      updatedAt: now,
    };
  });
  ipcMain.handle('chat-attachments:reference-file', (_event, value) => {
    const request = referenceChatAttachmentRequestSchema.parse(value);
    memoryDatabase.fetchCharacter(request.characterId);
    return createAssetService({ userDataPath, characterResourcesPath: join(userDataPath, 'unused') }).referenceChatAttachment(request.path, memoryDatabase, request.mediaType);
  });
  ipcMain.handle("chat-attachments:release", (_event, request) => {
    releasedAttachmentIds.push(request.assetId);
    return { success: true };
  });
  ipcMain.handle("thread-messages:delete", (_event, request) => {
    const key = messageKey(request.threadId, request.characterId);
    const deletedIds = new Set(request.messageIds);
    storedMessages.set(
      key,
      (storedMessages.get(key) ?? []).filter(
        (message) => !deletedIds.has(message.id),
      ),
    );
    return { success: true };
  });
  ipcMain.on("chat-stream:start", (event, request) => {
    chatAccessModes.set(request.threadId, agentModes.get(request.threadId) ?? "request-approval");
    const port = event.ports[0];
    if (port === undefined) return;
    activeChatStreamCount += 1;
    activeChatStreamsByCharacter.set(
      request.characterId,
      (activeChatStreamsByCharacter.get(request.characterId) ?? 0) + 1,
    );
    maximumConcurrentChatStreams = Math.max(
      maximumConcurrentChatStreams,
      activeChatStreamCount,
    );
    maximumConcurrentChatCharacters = Math.max(
      maximumConcurrentChatCharacters,
      activeChatStreamsByCharacter.size,
    );

    const stream = createUIMessageStream({
      originalMessages: request.messages,
      execute: async ({ writer }) => {
        if (avatarStatus.phase === "ready") {
          if (testingRealtime) {
            avatarStatus = { ...avatarStatus, busy: true };
            event.sender.send('avatar:changed', avatarStatus);
          }
          avatarChatRequests.push(request);
          const index = avatarChatRequests.length;
          writer.write({ type: "start-step" });
          writer.write({ type: "text-start", id: `text-${index}` });
          writer.write({ type: "text-delta", id: `text-${index}`, delta: `字幕对白第${index}句` });
          if (index === 1) await new Promise(resolve => { releaseAvatarOutput = resolve; });
          writer.write({ type: "text-end", id: `text-${index}` });
          writer.write({ type: "finish-step" });
          return;
        }
        const serializedMessages = JSON.stringify(request.messages);
        if (request.messages.at(-1)?.parts?.some(part => part.type === 'text' && part.text === '测试文件交付')) {
          writer.write({ type: 'start-step' });
          writer.write({ type: 'tool-input-available', toolCallId: 'failed-bash', toolName: 'bash', input: { command: 'cat missing.txt' } });
          writer.write({ type: 'tool-output-available', toolCallId: 'failed-bash', output: { stdout: '', stderr: 'File missing', exitCode: 1 } });
          writer.write({ type: 'text-start', id: 'file-delivery' });
          writer.write({ type: 'text-delta', id: 'file-delivery', delta: '[查看报告](outputs/report.txt)' });
          writer.write({ type: 'text-end', id: 'file-delivery' });
          writer.write({ type: 'finish-step' }); return;
        }
        if (request.messages.at(-1)?.parts?.some(part => part.type === "text" && part.text.includes("测试统一看图"))) {
          writer.write({ type: "start-step" });
          for (const [toolCallId, input, filename] of [
            ["image-original", { path: "/attachments/image/聊天原图.png" }, "聊天原图.png"],
            ["image-path", { path: "edited.png" }, "工作区修改图.png"],
          ]) {
            writer.write({ type: "tool-input-available", toolCallId, toolName: "view_image", input });
            writer.write({ type: "tool-output-available", toolCallId, output: { status: "loaded", filename, mediaType: "image/png", sourceByteSize: 3 } });
          }
          writer.write({ type: "text-start", id: "image-separator" });
          writer.write({ type: "text-delta", id: "image-separator", delta: "图片读取完成，接下来确认时间。" });
          writer.write({ type: "text-end", id: "image-separator" });
          writer.write({ type: "tool-input-available", toolCallId: "image-time", toolName: "get_current_time", input: {} });
          writer.write({ type: "tool-output-available", toolCallId: "image-time", output: { time: "12:00" } });
          writer.write({ type: "finish-step" });
          return;
        }
        if (serializedMessages.includes("测试网页批准")) {
          const approval = request.messages.flatMap(message => message.parts ?? []).find(part => part.type === 'tool-fetch_url' && part.approval?.approved !== undefined);
          writer.write({ type: "start-step" });
          if (!approval) {
            writer.write({ type: "tool-input-available", toolCallId: "web-ui", toolName: "fetch_url", input: { url: "https://example.com" } });
            writer.write({ type: "tool-approval-request", approvalId: "web-ui-approval", toolCallId: "web-ui", signature: "synthetic-web-signature" });
            writer.write({ type: "tool-input-available", toolCallId: "web-time", toolName: "get_current_time", input: {} });
            writer.write({ type: "tool-output-available", toolCallId: "web-time", output: { time: "12:00" } });
          } else {
            webApprovalResponses++;
            assert.equal(approval.approval.approved, true);
            assert.equal(approval.approval.signature, 'synthetic-web-signature');
            writer.write({ type: "tool-output-available", toolCallId: "web-ui", output: { type: "document", content: "synthetic page" } });
            writer.write({ type: "text-start", id: "web-done" });
            writer.write({ type: "text-delta", id: "web-done", delta: "网页批准已继续" });
            writer.write({ type: "text-end", id: "web-done" });
          }
          writer.write({ type: "finish-step" });
          return;
        }
        if (serializedMessages.includes("测试目录批准")) {
          const approval = request.messages.flatMap(message => message.parts ?? []).find(part => part.type === 'tool-request_directory_access' && part.approval?.approved !== undefined);
          writer.write({ type: "start-step" });
          if (!approval) {
            writer.write({ type: "tool-input-available", toolCallId: "directory-ui", toolName: "request_directory_access", input: { path: "Synthetic directory", access: "read", reason: "读取用户指定资料" } });
            writer.write({ type: "tool-approval-request", approvalId: "directory-ui-approval", toolCallId: "directory-ui", signature: "synthetic-signature" });
          } else {
            directoryApprovalResponses++;
            assert.equal(approval.approval.approved, true);
            assert.equal(approval.approval.signature, 'synthetic-signature');
            writer.write({ type: "tool-output-available", toolCallId: "directory-ui", output: { path: "/directories/synthetic", access: "read" } });
            writer.write({ type: "text-start", id: "directory-done" });
            writer.write({ type: "text-delta", id: "directory-done", delta: "目录批准已继续" });
            writer.write({ type: "text-end", id: "directory-done" });
          }
          writer.write({ type: "finish-step" });
          return;
        }
        if (serializedMessages.includes("测试工具终态")) {
          toolOnlyRequests += 1;
          if (request.messages.at(-1)?.role === "user" && JSON.stringify(request.messages.at(-1)).includes("测试工具终态")) {
            writer.write({ type: "start-step" });
            writer.write({ type: "tool-input-available", toolCallId: "terminal-memory", toolName: "memory", input: { request: { action: "search", queries: ["终态测试"], kind: null } } });
            writer.write({ type: "tool-output-available", toolCallId: "terminal-memory", output: { status: "ok", searches: [{ query: "终态测试", results: [], truncated: false }] } });
            writer.write({ type: "finish-step" });
            return;
          }
        }
        const isSecondCharacter = request.characterId === secondCharacter.id;
        const isCrossCharacterRun = serializedMessages.includes("跨角色");
        const shouldRenderPerformance = serializedMessages.includes("测试表演编排") && !serializedMessages.includes("avatar_perform");
        if (shouldRenderPerformance) {
          writer.write({ type: "start-step" });
          writer.write({ type: "tool-input-available", toolCallId: "performance-ui", toolName: "avatar_perform", input: { steps: [
            { at: "start", action: "system:greet", expression: "happy" },
            { at: "sentence", sentence: 2, expression: "surprised" },
            { at: "after_action", action: "system:clap" },
          ] } });
          writer.write({ type: "tool-output-available", toolCallId: "performance-ui", output: { status: "accepted", performanceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", steps: [
            { action: "问候", expression: "happy" }, { expression: "surprised" }, { action: "鼓掌" },
          ] } });
          writer.write({ type: "tool-input-available", toolCallId: "performance-ui-error", toolName: "avatar_perform", input: { steps: [{ at: "start", expression: "happy" }] } });
          writer.write({ type: "tool-output-error", toolCallId: "performance-ui-error", errorText: "角色编排队列已满。" });
          writer.write({ type: "tool-input-error", toolCallId: "performance-ui-invalid", toolName: "avatar_perform", input: { steps: [{ at: "start", expression: "confused" }] }, errorText: 'AI_InvalidToolInputError: expression "confused" is not an available expression.（故障编号：synthetic-validation）' });
          writer.write({ type: "tool-input-available", toolCallId: "performance-ui-ack", toolName: "avatar_perform", input: { steps: [{ at: "start", action: "system:greet", expression: "happy" }] } });
          writer.write({ type: "tool-output-available", toolCallId: "performance-ui-ack", output: { status: "accepted", performanceId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" } });
          writer.write({ type: "tool-input-available", toolCallId: "performance-ui-state-only", toolName: "avatar_perform", input: { steps: [{ at: "start", expression: "happy" }] } });
          writer.write({ type: "tool-output-available", toolCallId: "performance-ui-state-only", output: {} });
          writer.write({ type: "tool-input-available", toolCallId: "dance-ui", toolName: "avatar_play", input: { action: "action:test-dance" } });
          writer.write({ type: "tool-output-available", toolCallId: "dance-ui", output: { status: "accepted", performanceId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", action: "测试舞蹈" } });
          writer.write({ type: "tool-input-available", toolCallId: "dance-ui-error", toolName: "avatar_play", input: { action: "action:test-dance" } });
          writer.write({ type: "tool-output-error", toolCallId: "dance-ui-error", errorText: "舞蹈伴奏无法加载。" });
          writer.write({ type: "finish-step" }); writer.write({ type: "start-step" });
        }
        const shouldRenderMemoryTool =
          serializedMessages.includes("测试记忆工具") &&
          !serializedMessages.includes('"memory"') && !serializedMessages.includes('"tool-memory"');
        if (shouldRenderMemoryTool) {
          memoryToolRequests += 1;
          writer.write({ type: "start-step" });
          const toolCalls = [
            { id: "memory-list-call", action: "list",
              input: { kind: null, page: 2, pageSize: 2, sortBy: "updatedAt", order: "desc" },
              output: { page: 2, pageSize: 2, total: 42, hasMore: true, entries: [
                { id: "00000000-0000-4000-8000-000000000011", kind: "person", title: "示例人物", day: null, isUser: true, updatedAt: "2026-10-30T12:00:00.000Z", revision: 1 },
                { id: "00000000-0000-4000-8000-000000000012", kind: "event", title: "示例纪事", day: null, isUser: false, updatedAt: "2026-10-29T12:00:00.000Z", revision: 2 },
              ] } },
            { id: "memory-empty-list-call", action: "list",
              input: { kind: null, page: 99, pageSize: 2, sortBy: "updatedAt", order: "desc" },
              output: { page: 99, pageSize: 2, total: 42, hasMore: false, entries: [] } },
            {
              id: "memory-search-call",
              action: "search",
              input: { queries: ["不应显示的搜索词", "另一个不应显示的搜索词"], kind: null },
              output: {
                status: "ok",
                searches: [{ query: "不应显示的搜索词", results: [
                  {
                    id: "00000000-0000-4000-8000-000000000011", kind: "person", title: "示例人物", isUser: true,
                    body: "不应显示的记忆正文", revision: 1, bodyTruncated: false,
                  },
                ], truncated: true }, { query: "另一个不应显示的搜索词", results: [], truncated: false }],
              },
            },
            {
              id: "memory-get-call",
              action: "read",
              input: { ids: ["00000000-0000-4000-8000-000000000011", "00000000-0000-4000-8000-000000000012"] },
              output: {
                results: [{ id: "00000000-0000-4000-8000-000000000011", status: "found",
                entry: { id: "00000000-0000-4000-8000-000000000011", kind: "person", title: "示例人物", isUser: true,
                  body: "不应显示的读取正文", revision: 1, bodyTruncated: false },
                }, { id: "00000000-0000-4000-8000-000000000012", status: "not_found" }],
              },
            },
            {
              id: "memory-save-call",
              action: "save",
              input: {
                id: "00000000-0000-4000-8000-000000000011", revision: 1,
                kind: "person", title: "示例人物", body: "不应显示的保存正文", isUser: true,
              },
              output: {
                status: "saved",
                id: "00000000-0000-4000-8000-000000000011", revision: 2, title: "示例人物",
              },
            },
            { id: "memory-forget-call", action: "forget",
              input: { entries: [{ id: "00000000-0000-4000-8000-000000000011", revision: 2 },
                { id: "00000000-0000-4000-8000-000000000012", revision: 1 }] },
              output: { results: [{ status: "forgotten", id: "00000000-0000-4000-8000-000000000011", revision: 3, title: "示例人物" },
                { status: "conflict", id: "00000000-0000-4000-8000-000000000012", title: "示例纪事", message: "请重新读取。" }] } },
            { id: "memory-conflict-call", action: "save",
              input: { id: "00000000-0000-4000-8000-000000000011", revision: 1, kind: "person", title: "示例人物", body: "过时正文", isUser: true },
              output: { status: "conflict", message: "请重新读取。" } },
            { id: "memory-duplicate-call", action: "save",
              input: { id: null, revision: null, kind: "person", title: "示例人物", body: "重复正文", isUser: true },
              output: { status: "duplicate", existing: { id: "00000000-0000-4000-8000-000000000011", title: "示例人物" }, message: "请先读取。" } },
          ];
          for (const toolCall of toolCalls) {
            const input = { request: { action: toolCall.action, ...toolCall.input } };
            writer.write({
              type: "tool-input-start",
              toolCallId: toolCall.id,
              toolName: "memory",
            });
            writer.write({
              type: "tool-input-delta",
              toolCallId: toolCall.id,
              inputTextDelta: JSON.stringify(input),
            });
            writer.write({
              type: "tool-input-available",
              toolCallId: toolCall.id,
              toolName: "memory",
              input,
            });
            writer.write({
              type: "tool-output-available",
              toolCallId: toolCall.id,
              output: toolCall.output,
            });
          }
          writer.write({ type: "tool-input-error", toolCallId: "memory-invalid-input", toolName: "memory", input: { request: { action: "search", queries: 42 } }, errorText: "Invalid input for tool memory: 不应显示的错误参数正文" });
          writer.write({ type: "tool-output-error", toolCallId: "memory-invalid-input", errorText: "Invalid input for tool memory: 不应显示的错误参数正文" });
          writer.write({ type: "finish-step" });
          writer.write({ type: "start-step" });
        }
        writer.write({ type: "text-start", id: "mock-text" });
        writer.write({
          type: "text-delta",
          id: "mock-text",
          delta: isSecondCharacter ? "角色 B 已" : "角色 A 已",
        });
        writer.write({
          type: "text-delta",
          id: "mock-text",
          delta: `${isCrossCharacterRun ? "跨角色" : ""}收到：${request.threadId}。`,
        });
        writer.write({ type: "text-end", id: "mock-text" });
        if (shouldRenderMemoryTool || shouldRenderPerformance) writer.write({ type: "finish-step" });
      },
    });
    const response = createUIMessageStreamResponse({ stream });
    const reader = response.body.getReader();
    let pulls = 0;
    let reading = false;
    let closed = false;

    const close = () => {
      if (closed) return;
      closed = true;
      activeChatStreamCount -= 1;
      const characterStreamCount =
        (activeChatStreamsByCharacter.get(request.characterId) ?? 1) - 1;
      if (characterStreamCount === 0) {
        activeChatStreamsByCharacter.delete(request.characterId);
      } else {
        activeChatStreamsByCharacter.set(
          request.characterId,
          characterStreamCount,
        );
      }
      void reader.cancel();
      port.close();
    };
    const drain = async () => {
      if (reading || closed) return;
      reading = true;
      try {
        while (pulls > 0 && !closed) {
          pulls -= 1;
          const result = await reader.read();
          if (result.done) {
            port.postMessage({ type: "end" });
            close();
            return;
          }
          port.postMessage({ type: "data", data: result.value });
        }
      } finally {
        reading = false;
        if (pulls > 0 && !closed) void drain();
      }
    };

    port.on("message", ({ data }) => {
      if (data?.type === "cancel") {
        if (avatarStatus.phase === "ready") canceledAvatarStreams += 1;
        close();
        return;
      }
      if (data?.type === "pull") {
        pulls += 1;
        void drain();
      }
    });
    port.on("close", close);
    port.start();
  });
  ipcMain.handle("provider-configs:list", () => ({
    providerConfigs: emptyConfigMode ? (createdProvider === null ? [] : [createdProvider]) : [
      ...(createdProvider === null ? [] : [createdProvider]),
      {
        id: providerId,
        displayName: "DeepSeek",
        providerType: "deepseek",
        baseUrl: null,
        credentialRef: "safe-storage/12345678-1234-4123-8123-123456789abc",
        settings: null,
        enabled: true,
        createdAt: now,
        updatedAt: now,
      },
      ...(includeGoogleSpeechFixture
        ? [{
            id: googleProviderId,
            displayName: "Google",
            providerType: "google",
            baseUrl: null,
            credentialRef: "safe-storage/google-test",
            settings: null,
            enabled: true,
            createdAt: now,
            updatedAt: now,
          }]
        : []),
    ],
  }));
  ipcMain.handle("provider-configs:create", (_event, request) => {
    if (failProviderSave) throw new Error("合成保存失败，请稍后重试。");
    createdProviderRequest = request;
    createdProvider = {
      id: "5df8d817-cb76-4b8d-b16d-ea53b5d68457",
      displayName: request.displayName,
      providerType: request.providerType,
      baseUrl: request.baseUrl,
      credentialRef: null,
      settings: request.settings,
      enabled: request.enabled,
      createdAt: now,
      updatedAt: now,
    };
    return createdProvider;
  });
  ipcMain.handle("provider-configs:replace-credential", (_event, request) => {
    replacedCredentialRequest = request;
    createdProvider = { ...createdProvider, credentialRef: "safe-storage/87654321-4321-4321-8321-cba987654321", updatedAt: now };
    return createdProvider;
  });
  ipcMain.handle("provider-configs:delete", (_event, request) => {
    if (createdProvider?.id === request.id) createdProvider = null;
    return { success: true };
  });
  const listModelConfigs = () => ({
    modelConfigs: emptyConfigMode ? [] : [
      {
        id: modelId,
        providerConfigId: providerId,
        modelType: "languageModel",
        modelId: "deepseek-chat",
        displayName: "DeepSeek Chat",
        metadata: null,
        settings: null,
        enabled: modelEnabled,
        createdAt: now,
        updatedAt: now,
      },
      ...(includeGoogleSpeechFixture
        ? [{
            id: googleSpeechModelId,
            providerConfigId: googleProviderId,
            modelType: "speechModel",
            modelId: "gemini-2.5-flash-preview-tts",
            displayName: "Gemini 2.5 Flash TTS",
            metadata: {
              voices: [
                { id: "Kore", displayName: "Kore", description: "Firm" },
                ...(!googleVoiceCatalogRefreshed
                  ? [{ id: "Puck", displayName: "Puck", description: "Upbeat" }]
                  : []),
              ],
            },
            settings: { defaultVoiceId: "Kore" },
            enabled: true,
            createdAt: now,
            updatedAt: now,
          },
          {
            id: manualSpeechModelId,
            providerConfigId: googleProviderId,
            modelType: "speechModel",
            modelId: "account-custom-tts",
            displayName: "Custom Voice TTS",
            metadata: {
              voices: null,
            },
            settings: { defaultVoiceId: null },
            enabled: true,
            createdAt: now,
            updatedAt: now,
          }]
        : []),
      ...(createdModel === null ? [] : [createdModel]),
    ],
  });
  ipcMain.handle("model-configs:list", () => {
    if (failModelSettingsRead) throw new Error("Settings read fixture failure");
    return listModelConfigs();
  });
  ipcMain.handle("model-configs:fetch", (_event, request) => {
    const model = listModelConfigs().modelConfigs.find(item => item.id === request.id);
    if (!model) throw new Error("Model not found");
    return model;
  });
  ipcMain.handle("models:list-available", () => ({
    modelConfigIds: emptyConfigMode
      ? []
      : [
          modelId,
          ...(includeGoogleSpeechFixture
            ? [googleSpeechModelId, manualSpeechModelId]
            : []),
        ],
  }));
  ipcMain.handle("model-configs:discover", (_event, request) => {
    if (request.autoAdd) {
      automaticDiscoveryRequests += 1;
      assert.ok(replacedCredentialRequest, "Discovery must follow credential persistence");
      createdModel = {
        id: "3cab15e0-e330-4f78-80b9-8ebc99c919bd", providerConfigId: request.id,
        modelId: "deepseek-v4-pro", modelType: "languageModel", displayName: "DeepSeek V4 Pro",
        metadata: null, settings: null, enabled: true, createdAt: now, updatedAt: now,
      };
    }
    return {
    models: [
      { id: "custom-unknown", displayName: "Unknown Model", modelType: null, typeSource: null },
      {
        id: "deepseek-chat",
        displayName: "DeepSeek Chat",
        modelType: "languageModel",
        typeSource: "litellm-snapshot",
      },
      {
        id: "deepseek-v4-pro",
        displayName: "DeepSeek V4 Pro",
        modelType: "languageModel",
        typeSource: "litellm-snapshot",
      },
    ],
    source: "provider",
    warning: null,
  };
  });
  ipcMain.handle("model-configs:update", (_event, request) => {
    updatedModelRequest = request;
    modelEnabled = request.enabled;
    return {
      id: modelId,
      providerConfigId: providerId,
      ...request,
      metadata: null,
      createdAt: now,
      updatedAt: now,
    };
  });
  ipcMain.handle("model-configs:create", (_event, request) => {
    createdModelRequest = request;
    createdModel = {
      id: "3cab15e0-e330-4f78-80b9-8ebc99c919bd",
      ...request,
      metadata: null,
      createdAt: now,
      updatedAt: now,
    };
    return createdModel;
  });
  ipcMain.handle("characters:list", () => ({ characters }));
  ipcMain.handle("characters:create", (_event, request) => {
    createdCharacterCount += 1;
    createdCharacterRequest = request;
    const created = {
      id: `00000000-0000-4000-8000-${String(createdCharacterCount + 3).padStart(12, "0")}`,
      name: request.name,
      portraitAssetId: null,
      modelConfigId: request.modelConfigId,
      speechModelConfigId: request.speechModelConfigId,
      speechVoice: request.speechVoice,
      useDefaultSpeechModel: request.useDefaultSpeechModel ?? false, useDefaultSpeechVoice: request.useDefaultSpeechVoice ?? false,
      systemPrompt: request.systemPrompt,
      createdAt: new Date(now.getTime() + createdCharacterCount),
      updatedAt: new Date(now.getTime() + createdCharacterCount),
    };
    characters = [created, ...characters];
    return created;
  });
  ipcMain.handle("characters:delete", (_event, request) => {
    deletedCharacterRequest = request;
    const deletedIndex = characters.findIndex((candidate) => candidate.id === request.id);
    const replacementCharacter =
      characters[deletedIndex + 1] ?? characters[deletedIndex - 1];
    const deletedThreads = threads.filter((thread) => thread.characterId === request.id);
    threads = threads.filter((thread) => thread.characterId !== request.id);
    characters = characters.filter((candidate) => candidate.id !== request.id);
    if (activeCharacterId === request.id) activeCharacterId = replacementCharacter.id;
    return {
      deletedCharacterId: request.id,
      deletedThreadCount: deletedThreads.length,
      replacementCharacter,
      activeCharacter: characters.find(
        (candidate) => candidate.id === activeCharacterId,
      ),
    };
  });
  ipcMain.handle("characters:update", (_event, request) => {
    updatedCharacterRequest = request;
    const updated = {
      ...characters.find((candidate) => candidate.id === request.id),
      ...request,
      updatedAt: now,
    };
    characters = characters.map((candidate) =>
      candidate.id === request.id ? updated : candidate,
    );
    if (request.id === characterId) character = updated;
    return updated;
  });
  const packageActions = [
    { id: "00000000-0000-4000-8000-000000000041", key: "greet", name: "问候", description: "问候动作说明", playback: { kind: "oneShot", motion: "actions/greet.vrma" } },
    { id: "00000000-0000-4000-8000-000000000042", key: "idle", name: "基础待机", description: "循环动作说明", playback: { kind: "loop", motion: "actions/idle.vrma" } },
    { id: "00000000-0000-4000-8000-000000000043", key: "dance", name: "测试舞蹈", description: "舞蹈动作说明", playback: { kind: "performance", motion: "actions/dance.vrma" } },
  ];
  const builtin = { id: "builtin:default", builtin: true,
    manifest: { formatVersion: 3, name: "春原心奈", version: "1.0.0", portrait: "portrait.png", thumbnail: "thumbnail.png", model: "avatar.vrm", actions: packageActions.map(({ id, ...action }) => action) },
    portraitAssetId: "00000000-0000-4000-8000-000000000002", thumbnailAssetId: "00000000-0000-4000-8000-000000000004", actions: packageActions, referenceCount: characters.length };
  let packages = [builtin, { ...builtin,
    id: "00000000-0000-4000-8000-000000000031", builtin: false,
    manifest: { ...builtin.manifest, name: "测试角色包", author: "测试作者", actions: [] }, actions: [], referenceCount: 0 }];
  const listPackages = () => packages.map(pack => ({ ...pack,
    referenceCount: characters.filter(c => c.packageId === pack.id).length }));
  ipcMain.handle("character-packages:list", listPackages);
  ipcMain.handle("character-packages:detail", (_event, request) => listPackages().find(pack => pack.id === request.id));
  ipcMain.handle("character-packages:import", () => ({ canceled: true, package: null }));
  ipcMain.handle("character-packages:cancel", () => ({ success: true }));
  ipcMain.handle("character-packages:delete", (_event, request) => {
    const pack = listPackages().find(pack => pack.id === request.id);
    assert.ok(pack && !pack.builtin && pack.referenceCount === 0);
    packages = packages.filter(pack => pack.id !== request.id);
    return { success: true };
  });
  ipcMain.handle("character-packages:bind", (_event, request) => {
    const pack = packages.find(pack => pack.id === request.packageId);
    assert.ok(pack);
    const updated = { ...characters.find(c => c.id === request.characterId), packageId: request.packageId, packagePortraitAssetId: pack.portraitAssetId, packageThumbnailAssetId: pack.thumbnailAssetId };
    characters = characters.map(c => c.id === updated.id ? updated : c);
    if (character.id === updated.id) character = updated;
    return updated;
  });

}


const UI_WAIT_TIMEOUT_MS = 5_000;

async function waitForSelector(window, selector) {
  const timeoutMessage = `Timed out waiting for ${selector}`;
  await window.webContents.executeJavaScript(`
    new Promise((resolve, reject) => {
      const deadline = Date.now() + ${UI_WAIT_TIMEOUT_MS};
      const check = () => {
        if (document.querySelector(${JSON.stringify(selector)}) !== null) return resolve(true);
        if (Date.now() > deadline) return reject(new Error(${JSON.stringify(timeoutMessage)}));
        setTimeout(check, 20);
      };
      check();
    })
  `);
}

async function waitForText(window, selector, text) {
  const timeoutMessage = `Timed out waiting for "${text}" in ${selector}`;
  await window.webContents.executeJavaScript(`
    new Promise((resolve, reject) => {
      const deadline = Date.now() + ${UI_WAIT_TIMEOUT_MS};
      const check = () => {
        if (document.querySelector(${JSON.stringify(selector)})?.textContent.includes(${JSON.stringify(text)})) {
          return resolve(true);
        }
        if (Date.now() > deadline) return reject(new Error(${JSON.stringify(timeoutMessage)}));
        setTimeout(check, 20);
      };
      check();
    })
  `);
}

async function waitUntil(label, predicate) {
  const deadline = Date.now() + UI_WAIT_TIMEOUT_MS;
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((resolveWait) => setTimeout(resolveWait, 20));
  }
}

const latestAssistant = '[data-slot="aui_assistant-message-root"]:nth-last-child(1 of [data-role="assistant"])';
const disableMotionCss = `*, *::before, *::after {
  animation-delay: 0s !important;
  animation-duration: 0s !important;
  transition-delay: 0s !important;
  transition-duration: 0s !important;
}`;
let disabledMotionStyleKey;

async function expandLatestToolGroup(window) {
  const selector = `${latestAssistant} [data-slot="tool-group-trigger"]`;
  await waitForSelector(window, selector);
  await window.webContents.executeJavaScript(`(() => {
    const trigger = document.querySelector(${JSON.stringify(selector)});
    if (trigger.getAttribute('aria-expanded') === 'false') trigger.click();
  })()`);
}

async function checkToolDisclosureAnimation(window, selector, expectedOpen) {
  await window.webContents.removeInsertedCSS(disabledMotionStyleKey);
  try {
    const result = await window.webContents.executeJavaScript(`(async () => {
      const trigger = document.querySelector(${JSON.stringify(selector)});
      const panelId = trigger.getAttribute('aria-controls');
      trigger.click();
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const panel = document.getElementById(panelId ?? trigger.getAttribute('aria-controls'));
      const animation = panel?.getAnimations().find(item => item.animationName === ${JSON.stringify(expectedOpen ? 'collapsible-down' : 'collapsible-up')});
      const mounted = panel?.isConnected;
      const duration = animation?.effect.getTiming().duration;
      const frames = animation?.effect.getKeyframes().map(frame => frame.height);
      if (animation) await animation.finished;
      return { mounted, duration, frames, open: trigger.getAttribute('aria-expanded') };
    })()`);
    assert.equal(result.open, String(expectedOpen));
    assert.ok(result.duration > 0, `Tool disclosure must have a running height animation: ${JSON.stringify(result)}`);
    assert.ok(result.mounted, 'Tool disclosure must stay mounted during the transition');
    assert.equal(result.frames[expectedOpen ? 0 : result.frames.length - 1], '0px');
    assert.ok(result.frames.some(height => Number.parseFloat(height) > 0), 'Tool disclosure must animate to a measured height');
  } finally {
    disabledMotionStyleKey = await window.webContents.insertCSS(disableMotionCss);
  }
}

async function scrollLiveSettingIntoView(window, selector) {
  await window.webContents.executeJavaScript(`(() => {
    const panel = document.querySelector('.live-settings');
    const control = document.querySelector(${JSON.stringify(selector)});
    panel.scrollTop += control.getBoundingClientRect().top - panel.getBoundingClientRect().top;
  })()`);
}

async function clickSelector(window, selector) {
  await waitForSelector(window, selector);
  // A new conversation moves the composer from the docked footer to the
  // welcome layout. DOM presence alone does not make its coordinates stable.
  const point = await window.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const deadline = Date.now() + ${UI_WAIT_TIMEOUT_MS};
    let previousElement, previousBounds, stableFrames = 0;
    const check = () => {
      const element = document.querySelector(${JSON.stringify(selector)});
      const rect = element?.getBoundingClientRect();
      const bounds = rect && [rect.x, rect.y, rect.width, rect.height];
      const stable = element === previousElement && bounds && previousBounds && bounds.every((value, index) => Math.abs(value - previousBounds[index]) < 0.5);
      stableFrames = stable ? stableFrames + 1 : 0;
      if (rect?.width > 0 && rect.height > 0 && stableFrames >= 2) {
        window.testClickHandled = new Promise(resolveClick => {
          document.addEventListener('mouseup', () => requestAnimationFrame(() => resolveClick(true)), { once: true, capture: true });
        });
        resolve({x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2)});
        return;
      }
      if (Date.now() > deadline) { reject(new Error('Click target did not settle: ' + ${JSON.stringify(selector)})); return; }
      previousElement = element; previousBounds = bounds;
      requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
  })`);
  window.webContents.sendInputEvent({ type: "mouseMove", ...point });
  window.webContents.sendInputEvent({
    type: "mouseDown",
    button: "left",
    clickCount: 1,
    ...point,
  });
  window.webContents.sendInputEvent({
    type: "mouseUp",
    button: "left",
    clickCount: 1,
    ...point,
  });
  await window.webContents.executeJavaScript('window.testClickHandled');
}

async function openNewConversation(window) {
  await clickSelector(window, 'button[aria-label="新对话"]');
  await waitForSelector(window, '.aui-thread-welcome-root');
  await waitForSelector(window, '.aui-composer-input:not(:disabled)');
}

function createTestWindow(size = { width: 1280, height: 900 }) {
  const testWindow = new BrowserWindow({
    ...size,
    show: false,
    backgroundColor: "#ffffff",
    ...(process.platform === "win32" ? {
      titleBarStyle: "hidden",
      titleBarOverlay: { color: "#ffffff", symbolColor: "#1a1c1f", height: 36 },
    } : {}),
    webPreferences: {
      preload: join(projectRoot, "out", "preload", "index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      offscreen: true,
    },
  });
  testWindow.webContents.on("console-message", event => { if (event.level === "error") console.error("[renderer]", event.message); });
  return testWindow;
}

async function runStep(label, action) {
  const selected = process.env.KATARUNE_UI_TEST_STEPS?.split("|");
  if (selected && !selected.includes(label) && label !== "boot renderer") return;
  const startedAt = performance.now();
  console.log(`[ui-smoke] ${label}: start`);
  await action();
  console.log(`[ui-smoke] ${label}: pass (${Math.round(performance.now() - startedAt)} ms)`);
}

let exitCode = 0;

async function run() {
  registerMockHandlers();
  const mcpCredentials = await createCredentialStore({ userDataPath, cipher: {
    isEncryptionAvailable: () => safeStorage.isAsyncEncryptionAvailable(),
    encryptString: value => safeStorage.encryptStringAsync(value),
    decryptString: value => safeStorage.decryptStringAsync(value),
  } });
  mcpService = new McpService(memoryDatabase, mcpCredentials);
  registerMcpHandlers(mcpService);
  registerWindowThemeHandler(sender => BrowserWindow.fromWebContents(sender) ?? undefined);
  const window = createTestWindow();

  try {
    await runStep("boot renderer", async () => {
      await window.loadFile(join(projectRoot, "out", "renderer", "index.html"));
      await waitForSelector(window, '[data-slot="aui_thread-viewport"]');
      disabledMotionStyleKey = await window.webContents.insertCSS(disableMotionCss);
      await waitForSelector(window, '[data-testid="thread-starline-item"]');
    });

    await runStep("about settings reflect update actions", async () => {
      const action = '[data-testid="about-update-action"]:not(:disabled)';
      const status = '[data-testid="about-update-status"]';
      await clickSelector(window, '[data-testid="settings-launcher"]');
      await clickSelector(window, '[data-testid="settings-tab-about"]');
      await waitForText(window, '[data-testid="about-version"]', "v0.1.0");
      await waitForText(window, '[data-testid="about-settings"] a', "GitHub");
      const chromeInteraction = await window.webContents.executeJavaScript(`(() => {
        const panel = document.querySelector('[data-testid="about-settings"]');
        return {
          headingSelection: getComputedStyle(panel.querySelector('h2')).userSelect,
          linkDrag: getComputedStyle(panel.querySelector('a')).webkitUserDrag,
          imageDrag: getComputedStyle(panel.querySelector('img')).webkitUserDrag,
        };
      })()`);
      assert.deepEqual(chromeInteraction, { headingSelection: "none", linkDrag: "none", imageDrag: "none" });
      await waitForText(window, action, "检查更新");
      await waitForText(window, status, "当前已是最新版本");
      await waitUntil("latest version message clears", () => window.webContents.executeJavaScript(`document.querySelector(${JSON.stringify(status)}).textContent.trim() === ''`));
      writeFileSync(join(projectRoot, ".test-dist", "about-settings.png"), (await window.webContents.capturePage()).toPNG());
      await clickSelector(window, action);
      await waitForText(window, status, "无法检查更新");
      await clickSelector(window, action);
      await waitForText(window, status, "发现新版本 v0.2.0");
      await clickSelector(window, '[data-testid="settings-tab-general"]');
      await clickSelector(window, '[data-testid="settings-tab-about"]');
      await waitForText(window, status, "发现新版本 v0.2.0");
      await waitForText(window, action, "更新");
      await clickSelector(window, action);
      await waitForText(window, status, "正在准备安装");
      await clickSelector(window, '[data-testid="settings-back"]');
      await waitForSelector(window, '[data-testid="settings-launcher"]');
      assert.equal(await window.webContents.executeJavaScript(`getComputedStyle(document.querySelector('.aui-composer-input')).userSelect`), "text");
    });

    await runStep("form validation floats without changing layout", async () => {
      const activeToast = '[data-testid="notification-toast"][data-anchored="true"]:not([data-ending-style])';
      const fill = async (selector, value) => {
        await waitForSelector(window, selector);
        await window.webContents.executeJavaScript(`(() => {
          const input = document.querySelector(${JSON.stringify(selector)});
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(value)});
          input.dispatchEvent(new Event('input', { bubbles: true }));
        })()`);
      };
      const layout = selector => window.webContents.executeJavaScript(`(() => {
        const form = document.querySelector(${JSON.stringify(selector)});
        const bounds = form.getBoundingClientRect();
        const button = form.querySelector('button[type="submit"]').getBoundingClientRect();
        return { height: bounds.height, width: bounds.width, buttonTop: button.top - bounds.top };
      })()`);
      const waitForNoError = () => waitUntil('field error dismissed', () => window.webContents.executeJavaScript(`!document.querySelector(${JSON.stringify(activeToast)})`));
      await clickSelector(window, '[data-testid="settings-launcher"]');
      await clickSelector(window, '[data-testid="theme-light"]');
      await clickSelector(window, '[data-testid="settings-tab-models"]');
      await clickSelector(window, '[data-testid="add-provider"]');
      await waitForSelector(window, '#provider-secret');
      const providerLayout = await layout('[role="dialog"] form');
      await clickSelector(window, '[role="dialog"] button[type="submit"]');
      await waitForText(window, activeToast, '请填写API Key。');
      console.log('[forms] first field feedback ready');
      assert.equal(await window.webContents.executeJavaScript(`document.activeElement.id === 'provider-secret' && document.querySelector('#provider-secret').getAttribute('aria-invalid') === 'true' && document.querySelector('[role="dialog"] form').noValidate`), true);
      assert.equal(createdProviderRequest, null, 'invalid forms must not reach persistence');
      assert.deepEqual(await layout('[role="dialog"] form'), providerLayout, 'field errors must not move the dialog or submit button');
      assert.equal(await window.webContents.executeJavaScript(`document.querySelectorAll(${JSON.stringify(activeToast)}).length`), 1);
      assert.equal(await window.webContents.executeJavaScript(`(() => {
        const input = document.querySelector('#provider-secret');
        return (input.getAttribute('aria-describedby') ?? '').split(' ').some(id => document.getElementById(id)?.textContent.includes('请填写API Key。'));
      })()`), true, 'field errors must also be accessible without the popup');
      writeFileSync(join(projectRoot, '.test-dist', 'field-error-provider-light.png'), (await window.webContents.capturePage()).toPNG());
      const feedbackBounds = await window.webContents.executeJavaScript(`(() => {
        const input = document.querySelector('#provider-secret').getBoundingClientRect();
        const tip = document.querySelector(${JSON.stringify(activeToast)}).getBoundingClientRect();
        const x = Math.max(0, Math.floor(input.left) - 8), y = Math.max(0, Math.floor(input.top) - 8);
        return { x, y, width: Math.ceil(Math.max(input.right, tip.right)) + 8 - x, height: Math.ceil(Math.max(input.bottom, tip.bottom)) + 8 - y };
      })()`);
      writeFileSync(join(projectRoot, '.test-dist', 'field-error-detail.png'), (await window.webContents.capturePage(feedbackBounds)).toPNG());
      window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'ESC' });
      window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'ESC' });
      await waitForNoError();
      assert.equal(await window.webContents.executeJavaScript(`!!document.querySelector('[role="dialog"]')`), true, 'Escape must dismiss the field popup before the dialog');
      // Offscreen Chromium updates activeElement without dispatching native focus events.
      // Dispatch the focus transition explicitly when testing a refocused existing error.
      await window.webContents.executeJavaScript(`document.querySelector('#provider-name').focus(); document.querySelector('#provider-name').dispatchEvent(new FocusEvent('focusin', { bubbles: true }))`);
      assert.equal(await window.webContents.executeJavaScript(`document.activeElement.id`), 'provider-name');
      await window.webContents.executeJavaScript(`document.querySelector('#provider-secret').focus(); document.querySelector('#provider-secret').dispatchEvent(new FocusEvent('focusin', { bubbles: true }))`);
      await waitForText(window, activeToast, '请填写API Key。');
      console.log('[forms] refocused field feedback ready');
      await fill('#provider-secret', 'synthetic-key');
      await waitForNoError();
      await waitUntil('valid field cleared', () => window.webContents.executeJavaScript(`document.querySelector('#provider-secret').getAttribute('aria-invalid') !== 'true'`));
      await fill('#provider-url', 'not-a-url');
      await clickSelector(window, '[role="dialog"] button[type="submit"]');
      await window.webContents.executeJavaScript(`document.activeElement.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))`);
      await waitForText(window, activeToast, 'Base URL');
      assert.equal(await window.webContents.executeJavaScript(`document.activeElement.id`), 'provider-url');
      await fill('#provider-url', '');
      await waitForNoError();
      failProviderSave = true;
      try {
        await clickSelector(window, '[role="dialog"] button[type="submit"]');
        await waitForText(window, '[data-testid="notification-toast"]:not([data-anchored])', '合成保存失败');
        assert.deepEqual(await layout('[role="dialog"] form'), providerLayout, 'save failures must not occupy form layout');
        await clickSelector(window, '[data-testid="notification-toast"]:not([data-anchored]) button[aria-label="关闭通知"]');
      } finally { failProviderSave = false; }
      await clickSelector(window, '[data-slot="dialog-close"]');
      await clickSelector(window, '[data-testid="settings-tab-general"]');
      await clickSelector(window, '[data-testid="theme-dark"]');
      console.log('[forms] checking dark compact feedback');
      await clickSelector(window, '[data-testid="settings-tab-models"]');
      await clickSelector(window, '[data-testid="add-provider"]');
      await clickSelector(window, '[role="dialog"] button[type="submit"]');
      await waitForText(window, activeToast, '请填写API Key。');
      window.setSize(760, 520);
      await new Promise(resolveFrame => setTimeout(resolveFrame, 180));
      assert.equal(await window.webContents.executeJavaScript(`(() => { const rect = document.querySelector(${JSON.stringify(activeToast)}).getBoundingClientRect(); return rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight; })()`), true, 'anchored feedback must fit the compact viewport');
      writeFileSync(join(projectRoot, '.test-dist', 'field-error-provider-dark-compact.png'), (await window.webContents.capturePage()).toPNG());
      await clickSelector(window, '[data-slot="dialog-close"]');
      await waitForNoError();
      window.setSize(1280, 900);
      await clickSelector(window, '[data-testid="settings-tab-general"]');
      await clickSelector(window, '[data-testid="theme-light"]');
      await clickSelector(window, '[data-testid="settings-tab-models"]');
      await clickSelector(window, '[data-testid="add-model"]');
      await waitForSelector(window, '#model-id');
      const modelLayout = await layout('[role="dialog"] form');
      await clickSelector(window, '[role="dialog"] button[type="submit"]');
      await waitForText(window, activeToast, '模型 ID');
      assert.equal(await window.webContents.executeJavaScript(`document.activeElement.id`), 'model-id');
      assert.deepEqual(await layout('[role="dialog"] form'), modelLayout);
      await fill('#model-id', 'synthetic-model');
      await clickSelector(window, '[role="dialog"] button[type="submit"]');
      await waitForText(window, activeToast, '请选择模型类别');
      assert.equal(createdModelRequest, null);
      await clickSelector(window, '[data-slot="dialog-close"]');
      await waitForNoError();
      await clickSelector(window, '[data-testid="settings-tab-mcp"]');
      await clickSelector(window, '[data-testid="mcp-add"]');
      const mcpLayout = await layout('[data-testid="mcp-form"]');
      await window.webContents.executeJavaScript(`document.querySelector('[data-testid="mcp-save"]').scrollIntoView({ block: 'center' })`);
      await clickSelector(window, '[data-testid="mcp-save"]');
      await waitForText(window, activeToast, '请填写名称');
      assert.equal(await window.webContents.executeJavaScript(`document.activeElement.id`), 'mcp-name');
      assert.deepEqual(await layout('[data-testid="mcp-form"]'), mcpLayout);
      await fill('#mcp-name', '未保存的服务');
      await window.webContents.executeJavaScript(`document.querySelector('[data-testid="mcp-save"]').scrollIntoView({ block: 'center' })`);
      await clickSelector(window, '[data-testid="mcp-save"]');
      await window.webContents.executeJavaScript(`document.activeElement.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))`);
      await waitForText(window, activeToast, '启动命令');
      assert.equal(await window.webContents.executeJavaScript(`document.activeElement.id`), 'mcp-command');
      assert.equal(mcpService.list().length, 0);
      await fill('#mcp-command', 'node');
      for (let index = 0; index < 2; index++) {
        await window.webContents.executeJavaScript(`document.querySelector('button[aria-label="添加环境变量"]').scrollIntoView({ block: 'center' })`);
        await clickSelector(window, 'button[aria-label="添加环境变量"]');
      }
      await fill('input[name="transport.env.0.key"]', 'SAME_KEY');
      await fill('input[name="transport.env.1.key"]', 'SAME_KEY');
      await window.webContents.executeJavaScript(`document.querySelector('[data-testid="mcp-save"]').scrollIntoView({ block: 'center' })`);
      await clickSelector(window, '[data-testid="mcp-save"]');
      await waitUntil('schema error focuses the first duplicate key', () => window.webContents.executeJavaScript(`document.activeElement.name === 'transport.env.0.key'`));
      await window.webContents.executeJavaScript(`document.activeElement.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))`);
      await waitForText(window, activeToast, '名称不能重复');
      assert.equal(await window.webContents.executeJavaScript(`document.activeElement.name`), 'transport.env.0.key');
      await fill('input[name="transport.env.1.key"]', 'OTHER_KEY');
      await waitForNoError();
      assert.equal(await window.webContents.executeJavaScript(`document.querySelector('input[name="transport.env.0.key"]').getAttribute('aria-invalid') !== 'true'`), true, 'correcting a sibling field must clear stale schema errors');
      assert.equal(mcpService.list().length, 0);
      await clickSelector(window, '[data-testid="settings-back"]');
      await waitForNoError();
    });
    await runStep("MCP settings manage global services and protect credentials", async () => {
      const click = async selector => {
        await waitUntil('MCP action is ready', () => window.webContents.executeJavaScript(`(() => {
          const element = document.querySelector(${JSON.stringify(selector)});
          return !!element && !element.disabled && element.getAttribute('aria-disabled') !== 'true';
        })()`));
        await window.webContents.executeJavaScript(`document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({ block: 'center' })`);
        await clickSelector(window, selector);
      };
      const fill = async values => {
        for (const [selector] of values) await waitForSelector(window, selector);
        await window.webContents.executeJavaScript(`(() => {
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
          for (const [selector, value] of ${JSON.stringify(values)}) {
            const input = document.querySelector(selector);
            if (!input) throw new Error('Missing MCP field ' + selector);
            setter.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true }));
          }
        })()`);
      };
      await click('[data-testid="settings-launcher"]');
      await click('[data-testid="theme-light"]');
      await click('[data-testid="settings-tab-mcp"]');
      await waitForText(window, '[data-testid="mcp-settings"]', '还没有 MCP 服务');
      await click('[data-testid="mcp-add"]');
      await click('button[aria-label="添加参数"]');
      await click('button[aria-label="添加环境变量"]');
      await fill([
        ['#mcp-name', '本地工具测试'], ['#mcp-command', 'node'],
        ['input[aria-label="参数 1"]', join(projectRoot, 'tests', 'fixtures', 'mcp-server.mjs')],
        ['input[aria-label="环境变量键 1"]', 'MCP_FIXTURE_TOKEN'], ['input[aria-label="环境变量值 1"]', 'synthetic-token'],
      ]);
      await window.webContents.executeJavaScript(`document.querySelector('[data-testid="settings-content"]').scrollTop = 0; document.querySelector('[data-testid="settings-page"]').scrollTop = 0`);
      writeFileSync(join(projectRoot, '.test-dist', 'mcp-form-light.png'), (await window.webContents.capturePage()).toPNG());
      await click('[data-testid="mcp-save"]');
      await waitForText(window, '[data-testid="mcp-server"]', '已连接');
      const saved = mcpService.list()[0];
      assert.ok(saved && saved.tools.length === 3);
      const stored = memoryDatabase.fetchMcpConfig(saved.id);
      assert.ok(stored.credentialRef);
      assert.equal(JSON.stringify(stored).includes('synthetic-token'), false);
      await click('[data-testid="mcp-server"] button[aria-expanded]');
      await waitForText(window, '[data-testid="mcp-tools"]', 'increment');
      writeFileSync(join(projectRoot, '.test-dist', 'mcp-list-light.png'), (await window.webContents.capturePage()).toPNG());
      await click('[data-testid="mcp-edit"]');
      assert.equal(await window.webContents.executeJavaScript(`document.querySelector('input[aria-label="环境变量值 1"]').value`), '');
      await fill([['#mcp-name', '已编辑本地工具']]);
      await click('[data-testid="mcp-save"]');
      await waitForText(window, '[data-testid="mcp-server"]', '已编辑本地工具');
      await click('[role="switch"][aria-label="启用 已编辑本地工具"]');
      await waitForText(window, '[data-testid="mcp-server"]', '已停用');
      await click('[data-testid="mcp-edit"]');
      await fill([['#mcp-command', 'katarune-fixture-missing-program']]);
      await click('[data-testid="mcp-save"]');
      await waitForText(window, '[data-testid="mcp-server"]', '已停用');
      await click('[role="switch"][aria-label="启用 已编辑本地工具"]');
      await waitForText(window, '[data-testid="mcp-server"]', '找不到');
      await click('[data-testid="mcp-edit"]');
      await window.webContents.executeJavaScript(`document.querySelector('[data-testid="mcp-form"] [role="tab"]:last-child').click()`);
      await waitForSelector(window, '#mcp-url');
      await fill([['#mcp-url', 'https://example.invalid/mcp'], ['#mcp-token', 'synthetic-http-token']]);
      await window.webContents.executeJavaScript(`document.querySelector('[data-testid="mcp-form"] [role="tab"]').click()`);
      await waitForSelector(window, '#mcp-command');
      assert.equal(await window.webContents.executeJavaScript(`document.querySelector('input[aria-label="环境变量值 1"]').placeholder`), '已保存，留空保持');
      await window.webContents.executeJavaScript(`document.querySelector('[data-testid="mcp-form"] [role="tab"]:last-child').click()`);
      await waitForSelector(window, '#mcp-token');
      assert.equal(await window.webContents.executeJavaScript(`document.querySelector('#mcp-token').value`), 'synthetic-http-token');
      await window.webContents.executeJavaScript(`document.querySelector('[data-testid="settings-content"]').scrollTop = 0; document.querySelector('[data-testid="settings-page"]').scrollTop = 0`);
      writeFileSync(join(projectRoot, '.test-dist', 'mcp-http-form-light.png'), (await window.webContents.capturePage()).toPNG());
      // Stop before saving: no external service is contacted by this HTTP form check.
      await click('[data-testid="settings-tab-general"]');
      await click('[data-testid="theme-dark"]');
      await click('[data-testid="settings-tab-mcp"]');
      await click('[data-testid="mcp-edit"]');
      window.setSize(760, 520);
      await new Promise(resolveFrame => setTimeout(resolveFrame, 150));
      await window.webContents.executeJavaScript(`document.querySelector('[data-testid="settings-content"]').scrollTop = 0; document.querySelector('[data-testid="settings-page"]').scrollTop = 0`);
      writeFileSync(join(projectRoot, '.test-dist', 'mcp-form-dark-compact.png'), (await window.webContents.capturePage()).toPNG());
      assert.equal(await window.webContents.executeJavaScript(`document.documentElement.scrollWidth > innerWidth`), false);
      await click('[data-testid="settings-tab-general"]');
      await click('[data-testid="theme-light"]');
      window.setSize(1280, 900);
      await click('[data-testid="settings-tab-mcp"]');
      await click('[data-testid="mcp-delete"]');
      await click('[data-testid="confirm-dialog-confirm"]');
      await waitForText(window, '[data-testid="mcp-settings"]', '还没有 MCP 服务');
      assert.equal(memoryDatabase.listMcpConfigs().length, 0);
      await click('[data-testid="settings-back"]');
    });
    await runStep("composer tool permissions switch directly without leaving the draft", async () => {
      await window.webContents.executeJavaScript(`window.permissionUnhandledRejections = [];
        window.addEventListener('unhandledrejection', event => {
          window.permissionUnhandledRejections.push(String(event.reason));
        }); void 0`);
      const setComposerValue = (target, value) => target.webContents.executeJavaScript(`(() => {
        const input = document.querySelector('.aui-composer-input');
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, ${JSON.stringify(value)});
        input.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);
      await clickSelector(window, '[data-testid="thread-new"]');
      await waitForText(window, '[data-testid="agent-access-trigger"]', '请求批准');
      const initialThreadCount = threads.length;
      const initialModeCount = agentModes.size;
      assert.equal(await window.webContents.executeJavaScript(`document.querySelector('[data-testid="agent-access-trigger"]').closest('.aui-composer-action-wrapper') !== null`), true);
      await setComposerValue(window, '保留权限切换前的草稿');
      await clickSelector(window, '[data-testid="agent-access-trigger"]');
      await waitForSelector(window, '[data-testid="agent-access-option-full-access"]');
      assert.equal(await window.webContents.executeJavaScript(`'addAgentDirectory' in window.katarune`), false, 'directory grants must go through the approval tool, not a renderer grant API');
      await waitUntil('permission options loaded', () => window.webContents.executeJavaScript(`!document.querySelector('[data-testid="agent-access-option-full-access"]').disabled`));
      await clickSelector(window, '[data-testid="agent-access-option-full-access"]');
      await waitForText(window, '[data-testid="agent-access-trigger"]', '完全访问');
      assert.equal(threads.length, initialThreadCount, 'changing draft permissions must not create a conversation');
      assert.equal(agentModes.size, initialModeCount, 'draft permissions must not be persisted before sending');
      assert.equal(await window.webContents.executeJavaScript(`document.querySelector('[aria-label="消息输入"]').value`), '保留权限切换前的草稿');
      await new Promise(resolve => setTimeout(resolve, 250));
      writeFileSync(join(projectRoot, '.test-dist', 'agent-access-composer.png'), (await window.webContents.capturePage()).toPNG());
      window.setSize(760, 520);
      await clickSelector(window, '[data-testid="agent-access-trigger"]');
      await waitForSelector(window, '[data-testid="agent-access-menu"]');
      await waitUntil('draft permission selection restored', () => window.webContents.executeJavaScript(`document.querySelector('[data-testid="agent-access-option-full-access"]').getAttribute('aria-pressed') === 'true'`));
      await waitUntil('compact permission menu fits', () => window.webContents.executeJavaScript(`(() => { const r=document.querySelector('[data-testid="agent-access-menu"]').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight; })()`));
      await new Promise(resolve => setTimeout(resolve, 250));
      writeFileSync(join(projectRoot, '.test-dist', 'agent-access-composer-menu.png'), (await window.webContents.capturePage()).toPNG());
      await clickSelector(window, '.aui-composer-input');
      window.setSize(1280, 900);
      for (const mode of ['request-approval', 'full-access']) {
        await clickSelector(window, '[data-testid="agent-access-trigger"]');
        await waitUntil('draft permission options loaded', () => window.webContents.executeJavaScript(`!document.querySelector('[data-testid="agent-access-option-${mode}"]').disabled`));
        await clickSelector(window, `[data-testid="agent-access-option-${mode}"]`);
      }
      assert.equal(threads.length, initialThreadCount, 'repeated draft permission changes must not create a conversation');
      await clickSelector(window, '[data-testid="character-launcher"]');
      await waitForSelector(window, '[data-testid="character-system-prompt"]');
      await clickSelector(window, '[data-testid="character-back"]');
      await waitForText(window, '[data-testid="agent-access-trigger"]', '完全访问权限');
      assert.equal(await window.webContents.executeJavaScript(`document.querySelector('[aria-label="消息输入"]').value`), '保留权限切换前的草稿');
      const chatCountBeforeFailure = chatAccessModes.size;
      const titleCountBeforeFailure = titleRequests.length;
      failThreadInitialization = true;
      await clickSelector(window, 'button[aria-label="发送消息"]');
      await waitUntil('initialization failure delivered', () => failedThreadInitializations.length > 0);
      await waitForText(window, '[data-slot="aui_thread-viewport"]', '合成会话初始化失败');
      assert.equal(threads.length, initialThreadCount, 'failed initialization must not persist a conversation');
      assert.equal(agentModes.size, initialModeCount, 'failed initialization must not persist permissions');
      assert.equal(chatAccessModes.size, chatCountBeforeFailure, 'failed initialization must not start a model request');
      assert.equal(titleRequests.length, titleCountBeforeFailure, 'failed initialization must not generate a title');
      await waitForText(window, '[data-testid="agent-access-trigger"]', '完全访问权限');
      failThreadInitialization = false;
      await setComposerValue(window, '重试权限初始化');
      await clickSelector(window, 'button[aria-label="发送消息"]');
      await waitUntil('first message uses draft permissions', () => [...chatAccessModes.values()].includes('full-access'));
      const permissionThreadId = [...chatAccessModes.keys()].find(id => chatAccessModes.get(id) === 'full-access');
      assert.equal(permissionThreadId, failedThreadInitializations[0].threadId, 'retry must reuse the same draft conversation');
      assert.equal(threads.length, initialThreadCount + 1, 'first send creates exactly one conversation');
      await waitForText(window, '[data-slot="aui_thread-viewport"]', '收到：');
      await waitUntil('title generation resumes after initialization retry', () => titleRequests.some(request => request.threadId === permissionThreadId));
      assert.equal(failedThreadInitializations.length, 1, 'history must not retry failed initialization in the background');
      await waitUntil('retry preserves both user messages in history', () => {
        const messages = storedMessages.get(messageKey(permissionThreadId, characterId)) ?? [];
        return ['保留权限切换前的草稿', '重试权限初始化'].every(text => messages.some(message =>
          message.content.role === 'user' && message.content.parts?.some(part => part.type === 'text' && part.text === text)));
      });
      const recoveredMessages = storedMessages.get(messageKey(permissionThreadId, characterId));
      for (const [index, message] of recoveredMessages.entries()) {
        if (message.parent_id !== null) assert.ok(recoveredMessages.slice(0, index).some(parent => parent.id === message.parent_id), 'parents must be saved before their children');
      }
      await window.webContents.executeJavaScript(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
      assert.deepEqual(await window.webContents.executeJavaScript('window.permissionUnhandledRejections'), [], 'initialization failure must not leak Promise rejections');
      await window.webContents.executeJavaScript(`document.querySelector('.thread-starline-item[data-active="true"]')?.setAttribute('data-permission-test-thread','true')`);
      const savedThreadCount = threads.length;
      await clickSelector(window, '[data-testid="thread-new"]');
      await waitForText(window, '[data-testid="agent-access-trigger"]', '请求批准');
      assert.equal(threads.length, savedThreadCount, 'reading permissions for a blank conversation must not persist it');
      assert.equal(agentModes.get(permissionThreadId), 'full-access');
      await clickSelector(window, '[data-permission-test-thread="true"] .thread-starline-row');
      await waitForText(window, '[data-testid="agent-access-trigger"]', '完全访问权限');
      await clickSelector(window, '[data-testid="agent-access-trigger"]');
      await waitUntil('restored permission options loaded', () => window.webContents.executeJavaScript(`!document.querySelector('[data-testid="agent-access-option-request-approval"]').disabled`));
      await clickSelector(window, '[data-testid="agent-access-option-request-approval"]');
      await waitForText(window, '[data-testid="agent-access-trigger"]', '请求批准');
      assert.equal(agentModes.get(permissionThreadId), 'request-approval');
      window.setSize(1280, 900);
      await setComposerValue(window, '');
      await clickSelector(window, '[data-testid="character-launcher"]');
      await waitForSelector(window, '[data-testid="character-system-prompt"]');
      assert.equal(await window.webContents.executeJavaScript(`document.querySelector('[data-testid="agent-access-menu"], [data-testid="agent-access-trigger"], [data-testid="agent-access-panel"]') === null`), true);
      await clickSelector(window, '[data-testid="character-back"]');
      await waitForSelector(window, '[data-testid="agent-access-trigger"]');
    });
    await runStep("conversation context menu opens workspace without switching the current chat", async () => {
      const activeTitle = () => window.webContents.executeJavaScript(`document.querySelector('.thread-starline-item[data-active="true"] .thread-starline-title-text')?.textContent`);
      const before = await activeTitle();
      const openContextMenu = async () => {
        const point = await window.webContents.executeJavaScript(`(() => {
          const row = Array.from(document.querySelectorAll('[data-testid="thread-starline-item"]')).find(row => row.querySelector('.thread-starline-title-text')?.textContent.trim() === '测试会话 2');
          row.scrollIntoView({block:'center'});
          const r = row.getBoundingClientRect();
          return {x:Math.round(r.left+30),y:Math.round(r.top+r.height/2)};
        })()`);
        window.webContents.sendInputEvent({type:'mouseMove',...point});
        window.webContents.sendInputEvent({type:'mouseDown',button:'right',clickCount:1,...point});
        window.webContents.sendInputEvent({type:'mouseUp',button:'right',clickCount:1,...point});
        await waitForSelector(window, '[data-testid="thread-context-workspace"]');
      };
      await openContextMenu();
      await new Promise(resolve => setTimeout(resolve, 150));
      writeFileSync(join(projectRoot, '.test-dist', 'thread-workspace-context-menu.png'), (await window.webContents.capturePage()).toPNG());
      await clickSelector(window, '[data-testid="thread-context-workspace"]');
      await waitUntil('workspace action uses the conversation character', () => openedAgentWorkspaces.length === 1);
      assert.equal(openedAgentWorkspaces[0], characterId);
      assert.equal(await activeTitle(), before);
      await clickSelector(window, '[data-testid="agent-access-trigger"]');
      await waitForSelector(window, '[data-testid="agent-access-menu"]');
      assert.equal(await window.webContents.executeJavaScript(`document.querySelector('[data-testid="agent-access-menu"]').textContent.includes('打开工作区') || document.querySelector('[data-testid="agent-access-menu"]').textContent.includes('已批准目录')`), false);
      await clickSelector(window, '.aui-composer-input');
    });
    await runStep("livestream layout, configuration and local monitoring", async () => {
      const captureConnectionPanel = async name => {
        await window.webContents.executeJavaScript(`(async () => {
          await document.fonts.ready;
          const panel = document.querySelector('.live-events');
          await Promise.all(panel.getAnimations({subtree:true}).filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {})));
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        })()`);
        const bounds = await window.webContents.executeJavaScript(`(() => { const r=document.querySelector('.live-events').getBoundingClientRect();return {x:Math.floor(r.x)-2,y:Math.floor(r.y)-2,width:Math.ceil(r.width)+4,height:Math.ceil(r.height)+4}; })()`);
        writeFileSync(join(projectRoot,'.test-dist',name),(await window.webContents.capturePage(bounds)).toPNG());
      };
      await clickSelector(window, '[data-testid="live-launcher"]');
      await waitForSelector(window, '[data-testid="live-page"]');
      await waitForSelector(window, '#live-instructions');
      assert.equal(await window.webContents.executeJavaScript(`document.querySelector('[data-testid="live-character-name"]')?.textContent`), character.name);
      await waitForSelector(window, '[data-testid="live-connect-official"]');
      await waitForSelector(window, '[data-testid="live-connect-web"]');
      assert.equal(await window.webContents.executeJavaScript(`document.querySelector('.live-connect-form')===null`),true,'Disconnected rooms show connection choices first');
      await clickSelector(window, '[data-testid="live-toggle"]');
      await waitForText(window, '[data-testid="live-toggle"]', '停止');
      assert.equal(await window.webContents.executeJavaScript(`window.katarune.getLiveState().then(state=>state.phase==='running'&&state.connection==='disconnected'&&state.error===null)`), true);
      await clickSelector(window, '[data-testid="live-toggle"]');
      await waitForText(window, '[data-testid="live-toggle"]', '启动');
      await clickSelector(window, '[data-testid="live-character-trigger"]');
      await waitForSelector(window, '.live-character-menu button[aria-current="true"]');
      assert.ok(await window.webContents.executeJavaScript(`(() => {
        const trigger = document.querySelector('[data-testid="live-character-trigger"]').getBoundingClientRect();
        const menu = document.querySelector('.live-character-menu').getBoundingClientRect();
        return menu.bottom <= trigger.top && Math.abs(menu.width - trigger.width) < 1;
      })()`));
      window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
      window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
      await waitUntil('character popup dismisses and restores trigger focus', () => window.webContents.executeJavaScript(`!document.querySelector('.live-character-menu') && document.activeElement === document.querySelector('[data-testid="live-character-trigger"]')`));
      await clickSelector(window, '[data-testid="live-character-trigger"]');
      await waitForSelector(window, '.live-character-menu');
      await clickSelector(window, '#live-tab-interaction');
      await waitUntil('outside click dismisses character popup', () => window.webContents.executeJavaScript(`!document.querySelector('.live-character-menu')`));
      await waitForSelector(window, '[data-testid="live-connect-official"]');
      await scrollLiveSettingIntoView(window, 'label[for="live-proactive"]');
      await clickSelector(window, 'label[for="live-proactive"]');
      await waitUntil('proactive switch persists', () => window.webContents.executeJavaScript(`window.katarune.getLiveState().then(state=>!state.settings.proactive)`));
      await clickSelector(window, 'label[for="live-proactive"]');
      await waitUntil('proactive switch re-enables', () => window.webContents.executeJavaScript(`window.katarune.getLiveState().then(state=>state.settings.proactive)`));
      await window.webContents.executeJavaScript(`(() => {
        const input=document.querySelector('#live-instructions');input.focus();
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'本场聊游戏，礼物集中感谢。');
        input.dispatchEvent(new Event('input',{bubbles:true}));
      })()`);
      await clickSelector(window, '#live-tab-picture');
      await waitUntil('instructions save on leaving the tab', () => window.webContents.executeJavaScript(`window.katarune.getLiveState().then(state=>state.settings.instructions==='本场聊游戏，礼物集中感谢。')`));
      await waitForSelector(window, '#live-camera');
      for (const backgroundId of ['cloud-observatory', 'film', 'cloud-observatory']) {
        await clickSelector(window, '#live-background');
        await waitForSelector(window, `[data-testid="live-background-option-${backgroundId}"]`);
        await clickSelector(window, `[data-testid="live-background-option-${backgroundId}"]`);
        await waitUntil(`background ${backgroundId} persists`, () => window.webContents.executeJavaScript(`window.katarune.getLiveState().then(state=>state.settings.backgroundId===${JSON.stringify(backgroundId)})`));
      }
      await scrollLiveSettingIntoView(window, '#live-camera');
      for (const [view,label] of [['fullbody','全身'],['closeup','特写'],['overhead','俯视'],['side','侧拍'],['center','对话']]) {
        await clickSelector(window, '#live-camera');
        await waitForSelector(window, `[data-testid="live-camera-option-${view}"]`);
        await clickSelector(window, `[data-testid="live-camera-option-${view}"]`);
        await waitUntil(`camera ${view} persists`, () => window.webContents.executeJavaScript(`window.katarune.getLiveState().then(state=>state.settings.camera===${JSON.stringify(view)})`));
        await waitForText(window, '#live-camera', label);
      }
      await clickSelector(window, 'label[for="live-subtitles"]');
      await waitUntil('subtitles setting persists', () => window.webContents.executeJavaScript(`window.katarune.getLiveState().then(state=>!state.settings.subtitles)`));
      await clickSelector(window, '#live-tab-sound');
      await waitForSelector(window, '#live-voice-volume');
      await window.webContents.executeJavaScript(`(() => {
        const input=document.querySelector('#live-voice-volume');input.focus();
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'65');
        input.dispatchEvent(new Event('input',{bubbles:true}));
      })()`);
      await waitUntil('numeric volume updates the slider', () => window.webContents.executeJavaScript(`document.querySelector('#live-voice-volume-slider input[type="range"]').value==='65'`));
      await window.webContents.executeJavaScript(`document.querySelector('#live-music-volume-slider input[type="range"]').focus()`);
      for (const [keyCode,expected] of [['Home',0],['End',100]]) {
        window.webContents.sendInputEvent({type:'keyDown',keyCode});
        window.webContents.sendInputEvent({type:'keyUp',keyCode});
        await waitUntil('keyboard volume reaches its boundary',()=>window.webContents.executeJavaScript(`document.querySelector('#live-music-volume').value==='${expected}' && window.katarune.getLiveState().then(state=>state.settings.musicVolume===${expected / 100})`));
      }
      const volumeDrag = await window.webContents.executeJavaScript(`(() => {
        const control=document.querySelector('#live-music-volume-slider [data-slot="slider-control"]').getBoundingClientRect();
        const thumb=document.querySelector('#live-music-volume-slider [data-slot="slider-thumb"]').getBoundingClientRect();
        return {from:{x:Math.round(thumb.left+thumb.width/2),y:Math.round(thumb.top+thumb.height/2)},to:{x:Math.round(control.left+thumb.width/2+(control.width-thumb.width)*0.35),y:Math.round(control.top+control.height/2)}};
      })()`);
      window.webContents.sendInputEvent({type:'mouseMove',...volumeDrag.from});
      window.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...volumeDrag.from});
      window.webContents.sendInputEvent({type:'mouseMove',modifiers:['leftButtonDown'],...volumeDrag.to});
      await waitUntil('drag updates the percentage readout',()=>window.webContents.executeJavaScript(`document.querySelector('#live-music-volume').value==='35'`));
      window.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...volumeDrag.to});
      await waitUntil('drag release saves the volume',()=>window.webContents.executeJavaScript(`window.katarune.getLiveState().then(state=>state.settings.musicVolume===0.35&&state.settings.voiceVolume===0.65)`));
      await new Promise(resolve=>setTimeout(resolve,250));
      writeFileSync(join(projectRoot,'.test-dist','live-sound-sliders.png'),(await window.webContents.capturePage()).toPNG());
      await window.webContents.executeJavaScript(`document.documentElement.classList.add('dark')`);
      await new Promise(resolve=>setTimeout(resolve,250));
      writeFileSync(join(projectRoot,'.test-dist','live-sound-sliders-dark.png'),(await window.webContents.capturePage()).toPNG());
      await window.webContents.executeJavaScript(`document.documentElement.classList.remove('dark')`);
      await clickSelector(window, '#live-tab-output');
      await waitUntil('volume saves on leaving the tab', () => window.webContents.executeJavaScript(`window.katarune.getLiveState().then(state=>state.settings.voiceVolume===0.65)`));
      await waitForSelector(window, '#live-resolution');
      await waitForText(window, '.live-output', 'rtmp://127.0.0.1:1935/katarune/live');
      assert.equal(await window.webContents.executeJavaScript(`document.querySelector('#live-port')===null`),true);
      changeLiveFixture({phase:'error',error:'直播本地端口已被占用，请在输出 Tab 中修改本地端口。',errorCode:'port-in-use'});
      await waitForSelector(window, '#live-port');
      await scrollLiveSettingIntoView(window, '#live-port');
      await window.webContents.executeJavaScript(`(() => {
        const input=document.querySelector('#live-port');input.focus();
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'19445');
        input.dispatchEvent(new Event('input',{bubbles:true}));
      })()`);
      await clickSelector(window, '#live-tab-interaction');
      await waitUntil('port conflict can be corrected', () => window.webContents.executeJavaScript(`window.katarune.getLiveState().then(state=>state.settings.port===19445)`));
      assert.equal(await window.webContents.executeJavaScript(`document.querySelector('#live-instructions').value`),'本场聊游戏，礼物集中感谢。');
      changeLiveFixture({phase:'stopped',error:null,errorCode:null});
      await clickSelector(window, '[aria-label="关闭通知"]');
      await clickSelector(window, '#live-tab-output');
      await waitForText(window, '.live-output code', '19445');
      assert.equal(await window.webContents.executeJavaScript(`document.querySelector('#live-port')===null`),true);
      await waitUntil('default resolution is selected',()=>window.webContents.executeJavaScript(`document.querySelector('#live-resolution-1k').getAttribute('aria-selected')==='true'`));
      await waitUntil('default landscape is selected',()=>window.webContents.executeJavaScript(`document.querySelector('#live-aspect-landscape').getAttribute('aria-selected')==='true'`));
      await clickSelector(window, '#live-aspect-portrait');
      await waitUntil('portrait output persists without changing quality',()=>window.webContents.executeJavaScript(`window.katarune.getLiveState().then(state=>state.settings.aspectRatio==='9:16'&&state.settings.width===1920)`));
      assert.equal(await window.webContents.executeJavaScript(`document.querySelector('#live-resolution-1k').title`),'1080 × 1920');
      assert.equal(await window.webContents.executeJavaScript(`document.querySelector('#live-resolution-2k').title`),'1440 × 2560');
      await new Promise(resolve=>setTimeout(resolve,100));
      writeFileSync(join(projectRoot,'.test-dist','live-page-output-portrait.png'),(await window.webContents.capturePage()).toPNG());
      await window.webContents.executeJavaScript(`document.querySelector('#live-aspect-portrait').focus()`);
      // The hidden offscreen window does not emit native focus events. Use End
      // to establish the last tab as the keyboard navigation origin.
      window.webContents.sendInputEvent({type:'keyDown',keyCode:'End'});
      window.webContents.sendInputEvent({type:'keyUp',keyCode:'End'});
      await waitUntil('End focuses the last aspect ratio',()=>window.webContents.executeJavaScript(`document.activeElement===document.querySelector('#live-aspect-portrait')&&document.activeElement.tabIndex===0`));
      window.webContents.sendInputEvent({type:'keyDown',keyCode:'Left'});
      window.webContents.sendInputEvent({type:'keyUp',keyCode:'Left'});
      await waitUntil('aspect ratio keyboard focus moves',()=>window.webContents.executeJavaScript(`document.activeElement===document.querySelector('#live-aspect-landscape')`));
      window.webContents.sendInputEvent({type:'keyDown',keyCode:'Return'});
      window.webContents.sendInputEvent({type:'char',keyCode:'\r'});
      window.webContents.sendInputEvent({type:'keyUp',keyCode:'Return'});
      await waitUntil('keyboard landscape selection persists',()=>window.webContents.executeJavaScript(`window.katarune.getLiveState().then(state=>state.settings.aspectRatio==='16:9')`));
      assert.equal(await window.webContents.executeJavaScript(`document.querySelector('#live-resolution-1k').title`),'1920 × 1080');
      assert.equal(await window.webContents.executeJavaScript(`document.querySelector('#live-resolution-2k').title`),'2560 × 1440');
      await clickSelector(window, '#live-resolution-2k');
      await waitUntil('2K resolution persists',()=>window.webContents.executeJavaScript(`window.katarune.getLiveState().then(state=>state.settings.width===2560)`));
      await clickSelector(window, '#live-resolution-1k');
      await waitUntil('1K resolution persists',()=>window.webContents.executeJavaScript(`window.katarune.getLiveState().then(state=>state.settings.width===1920)`));
      await window.webContents.executeJavaScript(`document.querySelector('#live-resolution-1k').focus()`);
      window.webContents.sendInputEvent({type:'keyDown',keyCode:'Right'});
      window.webContents.sendInputEvent({type:'keyUp',keyCode:'Right'});
      await waitUntil('resolution keyboard focus moves',()=>window.webContents.executeJavaScript(`document.activeElement===document.querySelector('#live-resolution-2k')`));
      window.webContents.sendInputEvent({type:'keyDown',keyCode:'Return'});
      window.webContents.sendInputEvent({type:'char',keyCode:'\r'});
      window.webContents.sendInputEvent({type:'keyUp',keyCode:'Return'});
      await waitUntil('keyboard resolution selection persists',()=>window.webContents.executeJavaScript(`window.katarune.getLiveState().then(state=>state.settings.width===2560)`));
      await new Promise(resolve=>setTimeout(resolve,250));
      writeFileSync(join(projectRoot,'.test-dist','live-page-output.png'),(await window.webContents.capturePage()).toPNG());
      await clickSelector(window, '#live-tab-interaction');
      await clickSelector(window, '.live-monitor');
      await waitUntil('local monitoring toggled', () => window.webContents.executeJavaScript(`document.querySelector('.live-monitor')?.getAttribute('aria-pressed') === 'true'`));
      await window.webContents.executeJavaScript(`document.querySelector('.live-settings textarea').value`);
      await window.webContents.executeJavaScript(`document.fonts.ready.then(() => true)`);
      await new Promise(resolve => setTimeout(resolve, 250));
      writeFileSync(join(projectRoot, '.test-dist', 'live-page.png'), (await window.webContents.capturePage()).toPNG());
      await window.webContents.executeJavaScript(`document.documentElement.classList.add('dark')`);
      await new Promise(resolve => setTimeout(resolve, 100));
      writeFileSync(join(projectRoot, '.test-dist', 'live-page-dark.png'), (await window.webContents.capturePage()).toPNG());
      await window.webContents.executeJavaScript(`document.documentElement.classList.remove('dark')`);
      await clickSelector(window, '[data-testid="live-connect-official"]');
      await waitForSelector(window, '#live-app-id');
      const credentialsBeforeValidation = await window.webContents.executeJavaScript(`window.katarune.getLiveState().then(state => state.officialCredentialsConfigured)`);
      await window.webContents.executeJavaScript(`document.querySelector('.live-connect-form button[type="submit"]').scrollIntoView({ block: 'center' })`);
      await clickSelector(window, '.live-connect-form button[type="submit"]');
      await waitForText(window, '[data-testid="notification-toast"][data-anchored="true"]', '项目 ID');
      assert.equal(await window.webContents.executeJavaScript(`document.activeElement.id`), 'live-app-id');
      assert.equal(await window.webContents.executeJavaScript(`window.katarune.getLiveState().then(state => state.officialCredentialsConfigured)`), credentialsBeforeValidation);
      writeFileSync(join(projectRoot, '.test-dist', 'live-page-connection.png'), (await window.webContents.capturePage()).toPNG());
      const fillLiveConnection = values => window.webContents.executeJavaScript(`(() => {
        for (const [id,value] of Object.entries(${JSON.stringify(values)})) {
          const input=document.getElementById(id);
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);
          input.dispatchEvent(new Event('input',{bubbles:true}));
        }
        const form=document.querySelector('.live-connect-form'); form.scrollTop=form.scrollHeight;
      })()`);
      await fillLiveConnection({'live-app-id':'123','live-access-key':'synthetic','live-access-secret':'synthetic','live-identity-code':'synthetic'});
      await clickSelector(window, '.live-connect-form button[type="submit"]');
      await waitUntil('official connection saved', () => window.webContents.executeJavaScript(`window.katarune.getLiveState().then(state=>state.connection==='connected'&&state.officialCredentialsConfigured)`));
      await waitForSelector(window, '[aria-label="直播间配置信息"]');
      await waitForText(window, '[data-testid="live-room-description"]', '欢迎来到直播间');
      assert.equal(await window.webContents.executeJavaScript(`document.querySelector('[data-testid="live-room-description"]').textContent.includes('bad()')`),false);
      writeFileSync(join(projectRoot,'.test-dist','live-room-information.png'),(await window.webContents.capturePage()).toPNG());

      assert.equal(await window.webContents.executeJavaScript(`document.querySelector('.live-connect-form')===null`),true);
      await waitForText(window, '[data-testid="live-panel-title"]', '直播间');
      const roomEvents = [
        {id:'ui-live-danmaku',kind:'danmaku',roomId:'101',timestamp:1000,userId:'viewer',userName:'观众',text:'你好，主播',giftId:'',giftName:'',quantity:0},
        {id:'ui-live-gift',kind:'gift',roomId:'101',timestamp:1000,userId:'viewer',userName:'观众',text:'',giftId:'1',giftName:'小花',quantity:2},
      ];
      changeLiveFixture({broadcast:'offline',events:roomEvents});
      await waitForText(window, '[data-testid="live-room-status"]', '未开播');
      assert.equal(await window.webContents.executeJavaScript(`document.querySelectorAll('.live-event').length`),0,'Offline room must show room information');
      await waitForText(window, '[aria-label="返回连接方式"]', '返回');
      writeFileSync(join(projectRoot,'.test-dist','live-page-offline.png'),(await window.webContents.capturePage()).toPNG());
      await captureConnectionPanel('live-connection-info-detail.png');
      changeLiveFixture({broadcast:'live'});
      await waitForText(window, '[data-testid="live-panel-title"]', '弹幕');
      await waitForText(window, '[aria-label="直播间事件"]', '你好，主播');
      await waitForText(window, '[aria-label="直播间事件"]', '小花 × 2');
      writeFileSync(join(projectRoot,'.test-dist','live-page-onair.png'),(await window.webContents.capturePage()).toPNG());
      await captureConnectionPanel('live-connection-danmaku-detail.png');
      await clickSelector(window, '[aria-label="连接操作"]');
      await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[data-slot="popover-content"] button')).find(button=>button.textContent==='直播间信息').click()`);
      await waitForText(window, '[data-testid="live-panel-title"]', '直播间');
      await waitForSelector(window, '[aria-label="直播间配置信息"]');
      await clickSelector(window, '[aria-label="返回弹幕"]');
      await waitForText(window, '[data-testid="live-panel-title"]', '弹幕');
      changeLiveFixture({connection:'reconnecting',broadcast:'unknown'});
      await waitForText(window, '[data-testid="live-room-status"]', '正在重新连接直播间');
      changeLiveFixture({connection:'connected',broadcast:'offline'});
      await waitForText(window, '[data-testid="live-room-status"]', '未开播');
      const disconnectsBeforeReturn = liveDisconnectRequests;
      await clickSelector(window, '[aria-label="返回连接方式"]');
      await waitForSelector(window, '[data-testid="live-connect-web"]');
      assert.equal(liveDisconnectRequests, disconnectsBeforeReturn, 'Returning must not disconnect or discard configuration');
      assert.equal(await window.webContents.executeJavaScript(`window.katarune.getLiveState().then(state=>state.connection==='connected'&&state.officialCredentialsConfigured)`), true);
      assert.equal(await window.webContents.executeJavaScript(`document.querySelector('[data-testid="live-connect-official"]').getAttribute('aria-current')`), 'true');
      assert.equal(await window.webContents.executeJavaScript(`document.querySelector('[data-testid="live-panel-title"]')===null && document.querySelector('[aria-label="管理直播间连接"]')===null`),true,'Disconnected choices have no danmaku heading or connection status');
      assert.equal(await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.live-connection-choice')).every(button=>button.getBoundingClientRect().height>=50)`),true);
      writeFileSync(join(projectRoot,'.test-dist','live-connection-choices.png'),(await window.webContents.capturePage()).toPNG());
      await captureConnectionPanel('live-connection-choices-detail.png');
      await clickSelector(window, '[data-testid="live-connect-web"]');
      await waitForSelector(window, 'img[alt="使用B 站 App 扫码登录"]');
      window.setSize(960,680);
      await new Promise(resolve => setTimeout(resolve, 100));
      assert.equal(await window.webContents.executeJavaScript(`(() => {
        const panel=document.querySelector('.live-events'), refresh=panel.querySelector('[data-testid="live-login-refresh"]'), login=panel.querySelector('.live-account-login');
        const bounds=panel.getBoundingClientRect(), button=refresh.getBoundingClientRect();
        return !!refresh.closest('[data-slot="card-header"]') && button.top>=bounds.top && button.bottom<=bounds.bottom && button.right<=bounds.right && login.scrollHeight<=login.clientHeight+1;
      })()`),true,'Compact QR login keeps refresh in the header and needs no scrolling');
      assert.equal(await window.webContents.executeJavaScript(`document.querySelector('#live-web-room-id')===null&&document.querySelector('#live-web-cookie')===null`),true);
      writeFileSync(join(projectRoot,'.test-dist','live-bilibili-qr.png'),(await window.webContents.capturePage()).toPNG());
      await captureConnectionPanel('live-connection-qr-detail.png');
      await clickSelector(window, '[aria-label="返回连接方式"]');
      await waitForSelector(window, '[data-testid="live-connect-web"]');
      assert.equal(await window.webContents.executeJavaScript(`document.querySelector('.live-login-qr')===null`),true);
      liveHoldScanned = true;
      holdLiveConnect = true;
      releaseLiveConnect = undefined;
      await clickSelector(window, '[data-testid="live-connect-web"]');
      await waitForSelector(window, '[data-testid="live-login-success"][aria-label="扫码成功"]');
      await waitForText(window, '[aria-label="B 站账号登录"]', '请在手机上确认登录');
      assert.equal(await window.webContents.executeJavaScript(`document.querySelector('.live-login-qr')===null`),true,'Scanned QR is replaced by success feedback before phone confirmation');
      assert.equal(await window.webContents.executeJavaScript(`window.katarune.getLiveState().then(state=>!state.accounts?.some(account=>account.platform==='bilibili'))`),true,'Scanned does not imply authenticated');
      await captureConnectionPanel('live-login-scanned-compact.png');
      const loginsBeforeRefresh = liveLoginRequests;
      await clickSelector(window, '[data-testid="live-login-refresh"]');
      await waitUntil('header refresh starts a new login', () => liveLoginRequests === loginsBeforeRefresh + 1);
      await waitForSelector(window, '.live-login-qr');
      assert.equal(await window.webContents.executeJavaScript(`document.querySelector('[data-testid="live-login-success"]')===null`),true);
      liveHoldScanned = false;
      await waitUntil('confirmed login starts room detection', () => !!releaseLiveConnect);
      await waitForSelector(window, '[data-testid="live-login-success"][aria-label="登录成功"]');
      assert.equal(await window.webContents.executeJavaScript(`document.querySelector('.live-login-qr')===null&&document.querySelector('[data-testid="live-login-refresh"]')===null`),true,'Confirmed login hides QR and QR refresh while room detection is pending');
      await captureConnectionPanel('live-login-completed-compact.png');
      releaseLiveConnect(); holdLiveConnect = false; releaseLiveConnect = undefined;
      await waitForSelector(window, '[aria-label="直播间配置信息"]');
      window.setSize(1280,900);
      assert.equal(liveWebCredentialWrites,0,'QR-only connection must not overwrite account credentials');
      assert.equal(await window.webContents.executeJavaScript(`window.katarune.getLiveState().then(state=>state.accounts[0].platform==='bilibili'&&state.settings.webRoomId==='101')`),true);
      await waitForText(window, '[data-testid="live-room-status"]', '未开播');
      await clickSelector(window, '[aria-label="返回对话"]');
      changeLiveFixture({connection:'disconnected',broadcast:'unknown'});
      await waitForSelector(window, '[data-testid="live-launcher"]');
      const connectsBeforeReopen = liveConnectionRequests;
      await clickSelector(window, '[data-testid="live-launcher"]');
      await waitForSelector(window, '[data-testid="live-connect-web"]');
      assert.equal(liveConnectionRequests, connectsBeforeReopen);
      assert.equal(await window.webContents.executeJavaScript(`window.katarune.getLiveState().then(state=>state.connection)`), 'disconnected', 'Opening the page shows the saved method without connecting');
      const savedLoginRequests = liveLoginRequests;
      await clickSelector(window, '[data-testid="live-connect-web"]');
      await waitForSelector(window, '[aria-label="直播间配置信息"]');
      assert.equal(liveLoginRequests, savedLoginRequests, 'A saved account reconnects without showing another QR code');
      await clickSelector(window, '[aria-label="返回连接方式"]');
      await waitForSelector(window, '[data-testid="live-connect-douyin"]');
      liveQrFailure=true;
      await clickSelector(window, '[data-testid="live-connect-douyin"]');
      await waitForText(window, '[aria-label="抖音账号登录"]', '4031');
      assert.equal(await window.webContents.executeJavaScript(`document.querySelector('.live-login-qr')===null`),true);
      writeFileSync(join(projectRoot,'.test-dist','live-douyin-login-error.png'),(await window.webContents.capturePage()).toPNG());
      liveQrFailure=false;
      liveQrVerification=true;
      liveRoomMissing=true;
      await clickSelector(window, '[data-testid="live-login-refresh"]');
      await waitForSelector(window, 'img[alt="使用抖音 App 扫码登录"]');
      writeFileSync(join(projectRoot,'.test-dist','live-douyin-qr.png'),(await window.webContents.capturePage()).toPNG());
      await waitForSelector(window, '[data-testid="live-login-verification"]');
      assert.equal(await window.webContents.executeJavaScript(`!!document.querySelector('[aria-label="需要安全验证"]')&&!document.querySelector('[data-testid="live-login-success"]')&&!document.querySelector('.live-login-qr')`),true,'Additional verification must not look like successful authentication');
      await clickSelector(window, '[data-testid="live-login-verification"]');
      await waitUntil('explicit platform verification request', () => liveVerificationOpened === 1);
      await waitForSelector(window, '[aria-label="直播间配置信息"]');
      await waitForText(window, '[aria-label="返回连接方式"]', '返回');
      await waitForText(window, '[data-testid="live-account-info"]', '抖音合成主播');
      await waitUntil('validated account avatar loads', () => window.webContents.executeJavaScript(`(()=>{const img=document.querySelector('[data-testid="live-account-info"] img');return !!img&&img.complete&&img.naturalWidth>0;})()`));
      assert.equal(await window.webContents.executeJavaScript(`(()=>{const panel=document.querySelector('[aria-label="直播间配置信息"]');return !panel.textContent.includes('9007199254740997')&&!panel.textContent.includes('房间号')&&!panel.querySelector('[data-testid="live-room-description"]');})()`), true);
      await captureConnectionPanel('live-account-card-detail.png');
      await waitForText(window, '[data-testid="live-room-waiting"]', '开播后可重新检测');
      assert.equal(await window.webContents.executeJavaScript(`document.querySelector('[aria-label="直播间配置信息"] [role="alert"]')===null`), true);
      assert.equal(await window.webContents.executeJavaScript(`document.querySelector('[data-testid="live-toggle"]').disabled`), false);
      assert.equal(await window.webContents.executeJavaScript(`window.katarune.getLiveState().then(state=>state.error===null&&state.connection==='waiting')`), true);
      liveRoomMissing=false;
      await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[aria-label="直播间配置信息"] button')).find(button=>button.textContent==='重新检测').click()`);
      await waitForText(window, '[data-testid="live-room-status"]', '未开播');
      assert.equal(await window.webContents.executeJavaScript(`window.katarune.getLiveState().then(state => state.accounts.length === 2 && state.settings.platform === 'douyin' && state.settings.webRoomId === '102')`),true);
      changeLiveFixture({ broadcast: 'live', roomCover: 'https://p3-webcast.douyinpic.com/synthetic-cover.png' });
      await waitForText(window, '[data-testid="live-panel-title"]', '弹幕');
      await clickSelector(window, '[aria-label="连接操作"]');
      await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[data-slot="popover-content"] button')).find(button=>button.textContent==='直播间信息').click()`);
      await waitForSelector(window, 'img[alt="直播间封面"]');
      await waitUntil('Douyin cover passes IPC and CSP and decodes in the room panel', () => window.webContents.executeJavaScript(`(()=>{const img=document.querySelector('img[alt="直播间封面"]');return img?.src==='https://p3-webcast.douyinpic.com/synthetic-cover.png'&&img.complete&&img.naturalWidth>0;})()`));
      await window.webContents.executeJavaScript(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
      await captureConnectionPanel('live-douyin-cover-detail.png');
      await clickSelector(window, '[aria-label="返回弹幕"]');
      await clickSelector(window, '[aria-label="返回连接方式"]');
      await waitForSelector(window, '[data-testid="live-connect-official"]');
      const loginsBeforeSwitch = liveLoginRequests;
      await clickSelector(window, '[data-testid="live-connect-official"]');
      await waitForSelector(window, '[aria-label="直播间配置信息"]');
      assert.equal(await window.webContents.executeJavaScript(`document.querySelector('.live-connect-form')===null`), true, 'Switching to saved official credentials skips the form');
      await clickSelector(window, '[aria-label="返回连接方式"]');
      await clickSelector(window, '[data-testid="live-connect-web"]');
      await waitForText(window, '[data-testid="live-account-info"]', 'B站合成主播');
      await clickSelector(window, '[aria-label="返回连接方式"]');
      await clickSelector(window, '[data-testid="live-connect-douyin"]');
      await waitForText(window, '[data-testid="live-account-info"]', '抖音合成主播');
      assert.equal(liveLoginRequests, loginsBeforeSwitch, 'All three saved methods can be selected without reauthentication');
      await captureConnectionPanel('live-saved-account-detail.png');
      await clickSelector(window, '[aria-label="返回连接方式"]');
      await captureConnectionPanel('live-saved-connections.png');
      await clickSelector(window, '[data-testid="live-connect-douyin"]');
      await waitForText(window, '[data-testid="live-account-info"]', '抖音合成主播');
      changeLiveFixture({ phase: 'running' });
      await clickSelector(window, '[aria-label="返回连接方式"]');
      assert.equal(await window.webContents.executeJavaScript(`document.querySelector('[data-testid="live-connect-official"]').disabled && !document.querySelector('[data-testid="live-connect-douyin"]').disabled`), true, 'An active host can reopen its details but cannot switch methods');
      await clickSelector(window, '[data-testid="live-connect-douyin"]');
      await waitForSelector(window, '[aria-label="直播间配置信息"]');
      changeLiveFixture({ phase: 'stopped' });
      await clickSelector(window, '[aria-label="连接操作"]');
      await waitForSelector(window, '[data-testid="live-disconnect"]');
      await clickSelector(window, '[data-testid="live-disconnect"]');
      await waitForSelector(window, '[data-testid="live-connect-douyin"]');
      holdLiveConnect = true;
      await clickSelector(window, '[data-testid="live-connect-douyin"]');
      await waitUntil('pending room detection', () => !!releaseLiveConnect);
      await clickSelector(window, '[aria-label="返回连接方式"]');
      releaseLiveConnect(); holdLiveConnect = false;
      await waitUntil('late room detection completes', () => window.webContents.executeJavaScript(`window.katarune.getLiveState().then(state=>state.connection==='connected')`));
      await waitForSelector(window, '[data-testid="live-connect-douyin"]');
      assert.equal(await window.webContents.executeJavaScript(`document.querySelector('[aria-label="直播间配置信息"]')===null`), true, 'Late detection must not navigate away from connection choices');
      await waitUntil('room detection releases connection actions', () => window.webContents.executeJavaScript(`!document.querySelector('[data-testid="live-connect-douyin"]').disabled`));
      await clickSelector(window, '[data-testid="live-connect-douyin"]');
      await waitForSelector(window, '[aria-label="直播间配置信息"]');
      await clickSelector(window, '[aria-label="连接操作"]');
      await waitForSelector(window, '[data-testid="live-logout"]');
      await clickSelector(window, '[data-testid="live-logout"]');
      await waitForSelector(window, '[data-testid="live-connect-douyin"]');
      assert.equal(await window.webContents.executeJavaScript(`window.katarune.getLiveState().then(state=>state.accounts.length===1&&state.accounts[0].platform==='bilibili'&&state.officialCredentialsConfigured)`), true, 'Explicit logout only removes the chosen account');
      window.setSize(960,680);
      await new Promise(resolve => setTimeout(resolve, 100));
      writeFileSync(join(projectRoot, '.test-dist', 'live-page-compact.png'), (await window.webContents.capturePage()).toPNG());
      window.setSize(1280,900);
      await new Promise(resolve => setTimeout(resolve, 100));
      const fixture=join(runDirectory,'live-preview.mp4');
      execFileSync(join(projectRoot,'resources/live-media/ffmpeg.exe'),['-nostdin','-hide_banner','-loglevel','error','-y','-f','lavfi','-i','color=size=2560x1440:rate=60','-f','lavfi','-i','anullsrc=r=48000:cl=stereo','-t','2','-c:v','h264_mf','-pix_fmt','nv12','-profile:v','100','-level:v','51','-g','30','-bf','0','-c:a','aac','-movflags','frag_keyframe+empty_moov+default_base_moof',fixture],{windowsHide:true,timeout:30000});
      const fragments=[];
      new Mp4Preview((initialization,fragment)=>fragments.push({initialization:new Uint8Array(initialization),fragment:new Uint8Array(fragment),sequence:123+fragments.length})).write(readFileSync(fixture));
      changeLiveFixture({phase:'running',monitor:false});
      await new Promise(resolve=>setTimeout(resolve,250));
      for(const fragment of fragments){window.webContents.send(LIVE_CHANNELS.preview,fragment);await waitUntil('preview fragment appended',()=>livePreviewAcks.includes(fragment.sequence));}
      await waitUntil('full-size live video plays under CSP', () => window.webContents.executeJavaScript(`document.querySelector('.live-preview-frame')?.videoWidth === 2560 && document.querySelector('.live-preview-frame')?.videoHeight === 1440 && document.querySelector('.live-preview-frame')?.currentTime > 0`));
      assert.ok(livePreviewAcks.includes(123));
      assert.equal(await window.webContents.executeJavaScript(`document.querySelector('.live-preview-frame').muted`),false);
      // A missing segment must rejoin at the next independently decodable fragment.
      const rejoined={...fragments[0],sequence:200};window.webContents.send(LIVE_CHANNELS.preview,rejoined);
      await waitUntil('preview rejoins after backpressure',()=>livePreviewAcks.includes(200));
      await window.webContents.executeJavaScript(`window.liveVideoBeforeTabSwitch=document.querySelector('.live-preview-frame');void 0`);
      window.setSize(760,520);
      for (const [tab,control] of [['interaction','#live-instructions'],['picture','#live-camera'],['sound','#live-voice-volume'],['output','#live-resolution']]) {
        await clickSelector(window, `#live-tab-${tab}`);
        await waitForSelector(window, control);
        assert.equal(await window.webContents.executeJavaScript(`(() => {
          const tabs=[...document.querySelectorAll('[aria-label="直播参数分类"] [role="tab"]')];
          return tabs.length===4 && tabs.every(tab=>{const r=tab.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight;}) && document.querySelector('.live-preview-frame')===window.liveVideoBeforeTabSwitch;
        })()`),true,'Tabs must remain visible and preserve the running preview');
        await new Promise(resolve=>setTimeout(resolve,100));
        writeFileSync(join(projectRoot,'.test-dist',`live-tab-${tab}-compact.png`),(await window.webContents.capturePage()).toPNG());
      }
      assert.equal(await window.webContents.executeJavaScript(`[...document.querySelectorAll('#live-resolution [role=\"tab\"]')].every(tab=>tab.getAttribute('aria-disabled')==='true')`),true,'Running output resolution stays locked');
      assert.equal(await window.webContents.executeJavaScript(`[...document.querySelectorAll('#live-aspect-ratio [role=\"tab\"]')].every(tab=>tab.getAttribute('aria-disabled')==='true')`),true,'Running output aspect ratio stays locked');
      await scrollLiveSettingIntoView(window, '#live-aspect-portrait');
      await clickSelector(window, '#live-aspect-portrait');
      assert.equal(await window.webContents.executeJavaScript(`window.katarune.getLiveState().then(state=>state.settings.aspectRatio==='16:9')`),true,'A disabled aspect ratio tab must preserve the running output');
      await scrollLiveSettingIntoView(window, '#live-resolution-1k');
      await clickSelector(window, '#live-resolution-1k');
      assert.equal(await window.webContents.executeJavaScript(`window.katarune.getLiveState().then(state=>state.settings.width===2560)`),true,'A disabled resolution tab must not change the running output');
      await clickSelector(window, '#live-tab-interaction');
      await window.webContents.executeJavaScript(`document.querySelector('#live-tab-interaction').focus()`);
      window.webContents.sendInputEvent({type:'keyDown',keyCode:'Right'});
      window.webContents.sendInputEvent({type:'keyUp',keyCode:'Right'});
      await waitUntil('keyboard focuses the next parameter tab',()=>window.webContents.executeJavaScript(`document.activeElement===document.querySelector('#live-tab-picture')`));
      window.webContents.sendInputEvent({type:'keyDown',keyCode:'Return'});
      window.webContents.sendInputEvent({type:'char',keyCode:'\r'});
      window.webContents.sendInputEvent({type:'keyUp',keyCode:'Return'});
      await waitUntil('keyboard switches parameter tabs',()=>window.webContents.executeJavaScript(`document.querySelector('#live-tab-picture').getAttribute('aria-selected')==='true'`));
      assert.equal(await window.webContents.executeJavaScript(`window.katarune.getLiveState().then(state=>state.settings.voiceVolume===0.65&&!state.settings.subtitles&&state.settings.instructions==='本场聊游戏，礼物集中感谢。')`),true);
      window.setSize(1280,900);
      await clickSelector(window, '[aria-label="返回对话"]');
      await waitForSelector(window, '[data-testid="memory-launcher"]');
    });
    await runStep("browse, edit and forget real SQLite memories", async () => {
      const key = async (keyCode, modifiers = []) => {
        // sendInputEvent queues keyboard input; awaiting this helper must also
        // wait for the renderer to handle it before insertText or assertions.
        await window.webContents.executeJavaScript(`window.memoryKeyHandled = new Promise(resolve => {
          document.addEventListener('keyup', () => requestAnimationFrame(() => resolve(true)), { once: true });
        }); void 0`);
        window.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
        window.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
        await window.webContents.executeJavaScript('window.memoryKeyHandled');
      };
      const fill = async (selector, value, richText = false) => {
        if (richText) {
          await window.webContents.executeJavaScript(`document.querySelector(${JSON.stringify(selector)}).focus()`);
          await key('A', ['control']);
          await window.webContents.insertText(value);
        } else await window.webContents.executeJavaScript(`(() => {
          const input = document.querySelector(${JSON.stringify(selector)});
          Object.getOwnPropertyDescriptor(input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(value)});
          input.dispatchEvent(new Event('input', { bubbles: true }));
        })()`);
      };
      await clickSelector(window, '[data-testid="memory-launcher"]');
      await waitForSelector(window, '[data-testid="memory-page"]');
      await waitForText(window, '.memory-empty', '把相处留在日记里');
      await waitUntil('diary settings loaded', () => window.webContents.executeJavaScript(`!document.querySelector('[data-testid="memory-diary-toggle"]').disabled`));
      await clickSelector(window, '[data-testid="memory-diary-toggle"]');
      await waitUntil('diary disabled persisted', () => !memoryDatabase.getMemoryDiaryState(characterId).enabled);
      await clickSelector(window, '[data-testid="memory-tab-person"]');
      await waitForSelector(window, '[data-testid="memory-add"]');
      await clickSelector(window, '[data-testid="memory-add"]');
      await waitForSelector(window, '[data-testid="memory-editor"]');
      assert.equal(await window.webContents.executeJavaScript(`document.querySelector('[role="dialog"]') === null && document.querySelector('.memory-reading > [data-testid="memory-editor"]') !== null`), true, 'editing must remain in the original reading area');
      const memoryCountBeforeValidation = memoryDatabase.listMemory({ characterId, kind: 'person', query: '', offset: 0 }).entries.length;
      await clickSelector(window, '[data-testid="memory-save"]');
      await waitForText(window, '[data-testid="notification-toast"][data-anchored="true"]', '请填写标题');
      assert.equal(await window.webContents.executeJavaScript(`document.activeElement.dataset.testid`), 'memory-title-input');
      assert.equal(memoryDatabase.listMemory({ characterId, kind: 'person', query: '', offset: 0 }).entries.length, memoryCountBeforeValidation);
      await fill('[data-testid="memory-title-input"]', '小林');
      await clickSelector(window, '[data-testid="memory-save"]');
      await waitUntil('empty memory body receives focus', () => window.webContents.executeJavaScript(`document.activeElement.dataset.testid === 'memory-body-input'`));
      // Tiptap focuses on the next frame; offscreen Chromium needs the focus event explicitly.
      await window.webContents.executeJavaScript(`document.activeElement.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))`);
      await waitForText(window, '[data-testid="notification-toast"][data-anchored="true"]', '请填写正文');
      assert.equal(await window.webContents.executeJavaScript(`document.activeElement.dataset.testid`), 'memory-body-input');
      await fill('[data-testid="memory-body-input"]', '用户的朋友，喜欢读书。', true);
      await clickSelector(window, '.memory-user-label [role="switch"]');
      await waitUntil('person switch rendered', () => window.webContents.executeJavaScript(`document.querySelector('.memory-user-label [role="switch"]').getAttribute('aria-checked') === 'true'`));
      await clickSelector(window, '[data-testid="memory-save"]');
      await waitForText(window, '[data-testid="memory-detail"]', '用户的朋友');
      assert.equal(memoryDatabase.listMemory({ characterId, kind: 'person', query: '', offset: 0 }).entries[0].isUser, true, 'the shared person switch must persist the user flag');
      assert.equal(await window.webContents.executeJavaScript(`document.querySelector('#memory-is-user') === null`), true, 'reading a profile must not show the editing switch');
      await waitForText(window, '[data-testid="memory-list-item"][aria-current="true"] [aria-label="你的画像"]', '你');
      await clickSelector(window, '[data-testid="memory-tab-event"]');
      await waitForSelector(window, '[data-testid="memory-add"]');
      await clickSelector(window, '[data-testid="memory-add"]');
      await waitForSelector(window, '[data-testid="memory-editor"]');
      await fill('[data-testid="memory-title-input"]', '准备生日礼物');
      await fill('[data-testid="memory-body-input"]', '给小林挑选一本书。\n\n先了解她最近在读什么。', true);
      await clickSelector(window, '[data-testid="memory-save"]');
      await waitForText(window, '[data-testid="memory-detail"]', '给小林挑选一本书');
      writeFileSync(join(projectRoot, '.test-dist', 'memory-implementation.png'), (await window.webContents.capturePage()).toPNG());
      const compact = createTestWindow({ width: 760, height: 520 });
      try {
        await compact.loadFile(join(projectRoot, 'out', 'renderer', 'index.html'));
        await waitForSelector(compact, '[data-testid="memory-launcher"]');
        await clickSelector(compact, '[data-testid="memory-launcher"]');
        await waitForSelector(compact, '[data-testid="memory-tab-event"]');
        await clickSelector(compact, '[data-testid="memory-tab-event"]');
        await waitForText(compact, '[data-testid="memory-detail"]', '给小林挑选一本书');
        assert.equal(await compact.webContents.executeJavaScript('document.documentElement.scrollWidth <= window.innerWidth'), true);
        await compact.webContents.insertCSS('*, *::before, *::after { animation: none !important; transition: none !important; }');
        await new Promise(resolve => setTimeout(resolve, 300));
        writeFileSync(join(projectRoot, '.test-dist', 'memory-compact.png'), (await compact.webContents.capturePage()).toPNG());
      } finally { compact.destroy(); }
      await clickSelector(window, '[data-testid="memory-tab-person"]');
      await waitForText(window, '[data-testid="memory-detail"]', '用户的朋友');
      assert.equal(await window.webContents.executeJavaScript(`document.querySelector('[data-testid="memory-tab-person"]').getAttribute('aria-selected')`), 'true');
      await clickSelector(window, '[data-testid="memory-edit"]');
      await waitForSelector(window, '[data-testid="memory-editor"]');
      await fill('[data-testid="memory-body-input"]', '用户的朋友，喜欢科幻小说。', true);
      await key('A', ['control']);
      await key('B', ['control']);
      await window.webContents.insertText('用户的朋友，喜欢科幻小说。');
      await key('B', ['control']);
      assert.equal(await window.webContents.executeJavaScript(`document.querySelector('[data-testid="memory-body-input"] strong')?.textContent`), '用户的朋友，喜欢科幻小说。');
      const currentProfile = memoryDatabase.listMemory({ characterId, kind: 'person', query: '', offset: 0 }).entries[0];
      const latestProfile = memoryDatabase.readMemory(characterId, currentProfile.id);
      memoryDatabase.saveMemory(characterId, { id: latestProfile.id, revision: latestProfile.revision, content: { kind: 'person', title: '小林', isUser: false, body: '后台更新的画像。' } });
      await waitForText(window, '[data-testid="memory-body-input"]', '喜欢科幻小说');
      await clickSelector(window, '[data-testid="memory-save"]');
      await waitForText(window, '[data-testid="notification-toast"]:not([data-anchored])', '这条记忆已被更新');
      await waitForText(window, '[data-testid="memory-body-input"]', '喜欢科幻小说');
      assert.equal(memoryDatabase.readMemory(characterId, currentProfile.id).content.body, '后台更新的画像。');
      await clickSelector(window, '[data-testid="notification-toast"][data-level="error"] [aria-label="关闭通知"]');
      await clickSelector(window, '[data-testid="memory-cancel"]');
      await waitForText(window, '[data-testid="memory-detail"]', '后台更新的画像');
      await clickSelector(window, '[data-testid="memory-edit"]');
      await waitForSelector(window, '[data-testid="memory-body-input"]');
      await fill('[data-testid="memory-body-input"]', '用户的朋友，喜欢科幻小说。', true);
      await clickSelector(window, '[data-testid="memory-save"]');
      await waitForText(window, '[data-testid="memory-detail"]', '喜欢科幻小说');
      await clickSelector(window, '[data-testid="memory-forget"]');
      await waitForSelector(window, '[data-testid="confirm-dialog-confirm"]');
      await clickSelector(window, '[data-testid="confirm-dialog-confirm"]');
      await waitForText(window, '.memory-empty', '慢慢认识身边的人');
      await waitUntil('memory forget dialog closed', () => window.webContents.executeJavaScript(`document.querySelector('[data-testid="confirm-dialog-confirm"]') === null`));
      assert.equal(memoryDatabase.listMemory({ characterId, kind: 'person', query: '', offset: 0 }).entries.length, 0);
      memoryDatabase.initializeThread('memory-ui-source', characterId);
      memoryDatabase.appendThreadMessage({ characterId, threadId: 'memory-ui-source', assetIds: [], message: {
        id: 'memory-ui-message', parent_id: null, format: 'ai-sdk/v6', content: { role: 'user', parts: [{ type: 'text', text: '小林的生日快到了，想送她一本科幻小说。' }] },
      } });
      memoryDatabase.saveMemory(characterId, { id: null, revision: null, content: {
        kind: 'diary', day: '2026-10-17', title: '书店里的午后', body: '今天我听她讲起路过的小书店。',
      } });
      memoryDatabase.saveMemory(characterId, { id: null, revision: null, content: {
        kind: 'diary', day: '2026-10-18', title: '一起挑选生日礼物', body: '今天聊到了小林的生日。知道她喜欢科幻小说后，我们把礼物的方向定在了一本书上。\n\n还没有决定具体哪一本，准备先了解她最近在读什么。',
      } });
      await clickSelector(window, '[data-testid="memory-tab-diary"]');
      await waitForText(window, '[data-testid="memory-detail"]', '一起挑选生日礼物');
      writeFileSync(join(projectRoot, '.test-dist', 'memory-diary.png'), (await window.webContents.capturePage()).toPNG());
      const selectDiary = async (title) => {
        await waitUntil(`diary item ${title} available`, () => window.webContents.executeJavaScript(`(() => {
          const button = Array.from(document.querySelectorAll('[data-testid="memory-list-item"]')).find(button => button.textContent.includes(${JSON.stringify(title)}));
          if (!button) return false;
          button.click(); return true;
        })()`));
        await waitForText(window, '[data-testid="memory-detail"]', title);
      };
      const diaryLayout = target => target.webContents.executeJavaScript(`(() => {
        const viewport = document.querySelector('.memory-diary-scroll');
        const body = document.querySelector('.memory-body');
        const rect = element => Array.from(element.getClientRects(), box => [box.x, box.y, box.width, box.height]);
        const lines = [];
        const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          const range = document.createRange();
          range.selectNodeContents(walker.currentNode);
          lines.push([walker.currentNode.textContent, rect(range)]);
        }
        return { scroll: viewport.scrollTop, height: viewport.scrollHeight, viewport: rect(viewport), title: rect(document.querySelector('.memory-title-input')), lines };
      })()`);
      const checkDiaryModeSwitch = async target => {
        await target.webContents.executeJavaScript(`document.fonts.ready.then(() => { window.memoryBodyBeforeSwitch = document.querySelector('.memory-body'); return true; })`);
        const before = await diaryLayout(target);
        await clickSelector(target, '[data-testid="memory-edit"]');
        await waitForSelector(target, '[data-testid="memory-editor"] .memory-body[contenteditable="true"]');
        assert.deepEqual(await diaryLayout(target), before, 'entering edit must preserve text layout and scroll position');
        assert.equal(await target.webContents.executeJavaScript(`window.memoryBodyBeforeSwitch === document.querySelector('.memory-body')`), true, 'reading and editing must retain the same document node');
        await clickSelector(target, '[data-testid="memory-cancel"]');
        await waitForSelector(target, '[data-testid="memory-detail"] .memory-body[contenteditable="false"]');
        assert.deepEqual(await diaryLayout(target), before, 'cancel without changes must preserve layout and scroll position');
        await clickSelector(target, '[data-testid="memory-edit"]');
        await waitForSelector(target, '[data-testid="memory-editor"] .memory-body[contenteditable="true"]');
        await clickSelector(target, '[data-testid="memory-save"]');
        await waitForSelector(target, '[data-testid="memory-detail"] .memory-body[contenteditable="false"]');
        assert.deepEqual(await diaryLayout(target), before, 'save without changes must preserve layout and scroll position');
        assert.equal(await target.webContents.executeJavaScript(`window.memoryBodyBeforeSwitch === document.querySelector('.memory-body')`), true, 'save refresh must retain the same document node');
      };
      const checkDiaryEnd = async target => {
        await target.webContents.executeJavaScript(`(() => { const viewport = document.querySelector('.memory-diary-scroll'); viewport.scrollTop = viewport.scrollHeight; })()`);
        assert.equal(await target.webContents.executeJavaScript(`(() => {
          const viewport = document.querySelector('.memory-diary-scroll').getBoundingClientRect();
          const body = document.querySelector('.memory-body');
          const last = body.lastElementChild.getBoundingClientRect();
          return last.left >= viewport.left - 1 && last.right <= viewport.right + 1 && last.top >= viewport.top - 1 && last.bottom <= viewport.bottom + 1;
        })()`), true, 'scrolling to the bottom must reveal the last paragraph');
      };
      await checkDiaryModeSwitch(window);
      await selectDiary('书店里的午后');
      assert.equal(await window.webContents.executeJavaScript(`document.querySelector('.memory-diary-scroll').scrollHeight <= document.querySelector('.memory-diary-scroll').clientHeight + 1`), true, 'a short diary should fit naturally');
      for (const [day, title, body] of [
        ['2026-10-10', '以代码块结尾', '\x60\x60\x60text\n' + Array.from({ length: 70 }, (_, index) => `记录 ${index + 1}`).join('\n') + '\n\x60\x60\x60'],
        ['2026-10-11', '以表格结尾', '| 时刻 | 小事 |\n| --- | --- |\n' + Array.from({ length: 30 }, (_, index) => `| ${index + 1} | 值得记住的小事 |`).join('\n')],
      ]) {
        const result = memoryDatabase.saveMemory(characterId, { id: null, revision: null, content: { kind: 'diary', day, title, body: '整理中。' } });
        assert.equal(result.status, 'saved');
        await waitForText(window, '.memory-list', title);
        await selectDiary(title);
        const updated = memoryDatabase.saveMemory(characterId, { id: result.entry.id, revision: result.entry.revision, content: { kind: 'diary', day, title, body } });
        assert.equal(updated.status, 'saved');
        await waitUntil('background diary content rendered', () => window.webContents.executeJavaScript(`!document.querySelector('.memory-body').textContent.includes('整理中。')`));
        assert.equal(await window.webContents.executeJavaScript(`document.querySelector('.memory-diary-scroll').scrollHeight > document.querySelector('.memory-diary-scroll').clientHeight`), true, 'large blocks must flow through the normal diary scroll area');
        await checkDiaryEnd(window);
        await checkDiaryModeSwitch(window);
        assert.equal(memoryDatabase.readMemory(characterId, result.entry.id).content.body, body, 'reading must not alter stored content');
      }
      memoryDatabase.saveMemory(characterId, { id: null, revision: null, content: {
        kind: 'diary', day: '2026-10-16', title: '很长的一天', body: Array.from({ length: 24 }, (_, index) => `第${index + 1}段。今天我们沿着河边慢慢走，聊了最近在读的书，也聊到下个周末的小计划。风经过水面的时候，她停了一会儿，我也陪着她安静下来。`).join('\n\n') + '\n\n\x60\x60\x60text\n' + Array.from({ length: 60 }, (_, index) => `记录 ${index + 1}`).join('\n') + '\n\x60\x60\x60\n\n| 时刻 | 记下的小事 |\n| --- | --- |\n' + Array.from({ length: 24 }, (_, index) => `| ${index + 1} | 一点值得记住的事情 |`).join('\n') + '\n\n长文终点，今天就写到这里。',
      } });
      await waitForText(window, '.memory-list', '很长的一天');
      await selectDiary('很长的一天');
      assert.equal(await window.webContents.executeJavaScript(`document.querySelector('.memory-diary-scroll').scrollHeight > document.querySelector('.memory-diary-scroll').clientHeight`), true);
      await checkDiaryEnd(window);
      await checkDiaryModeSwitch(window);
      writeFileSync(join(projectRoot, '.test-dist', 'memory-diary-scroll.png'), (await window.webContents.capturePage()).toPNG());
      const compactDiary = createTestWindow({ width: 760, height: 520 });
      try {
        await compactDiary.loadFile(join(projectRoot, 'out', 'renderer', 'index.html'));
        await waitForSelector(compactDiary, '[data-testid="memory-launcher"]');
        await clickSelector(compactDiary, '[data-testid="memory-launcher"]');
        await waitForText(compactDiary, '.memory-list', '很长的一天');
        await waitUntil('compact diary item available', () => compactDiary.webContents.executeJavaScript(`(() => {
          const button = Array.from(document.querySelectorAll('[data-testid="memory-list-item"]')).find(button => button.textContent.includes('很长的一天'));
          if (!button) return false;
          button.click(); return true;
        })()`));
        await waitForText(compactDiary, '[data-testid="memory-detail"]', '长文终点');
        assert.equal(await compactDiary.webContents.executeJavaScript(`document.querySelector('.memory-diary-scroll').clientHeight > 60`), true);
        assert.equal(await compactDiary.webContents.executeJavaScript('document.documentElement.scrollWidth <= window.innerWidth'), true);
        await checkDiaryEnd(compactDiary);
        await checkDiaryModeSwitch(compactDiary);
        writeFileSync(join(projectRoot, '.test-dist', 'memory-diary-compact.png'), (await compactDiary.webContents.capturePage()).toPNG());
      } finally { compactDiary.destroy(); }
      await selectDiary('一起挑选生日礼物');
      const formattedDiary = memoryDatabase.saveMemory(characterId, { id: null, revision: null, content: { kind: 'diary', day: '2026-10-14', title: '有排版的日记', body: '**粗体**和*强调*，还有~~划掉的字~~与`行内代码`。\n\n- 一段列表\n- 另一段列表\n\n- [x] 已做的小事\n- [ ] 还没做的事\n\n> 一句想记住的话。\n\n| 时间 | 内容 |\n| --- | --- |\n| 傍晚 | 散步 |\n\n```text\n一段代码\n```\n\n[一个链接](https://example.invalid)\n\n日记末尾。' } });
      assert.equal(formattedDiary.status, 'saved');
      await waitForText(window, '.memory-list', '有排版的日记');
      await selectDiary('有排版的日记');
      await checkDiaryModeSwitch(window);
      const formattedBeforeRead = memoryDatabase.readMemory(characterId, formattedDiary.entry.id);
      assert.equal(await window.webContents.executeJavaScript(`(() => {
        const checkbox = document.querySelector('.memory-body ul[data-type="taskList"] input[type="checkbox"]');
        const checked = checkbox.checked;
        checkbox.click();
        return checkbox.checked === checked;
      })()`), true, 'reading a diary must not toggle task checkboxes');
      assert.deepEqual(memoryDatabase.readMemory(characterId, formattedDiary.entry.id), formattedBeforeRead);
      await clickSelector(window, '[data-testid="memory-edit"]');
      await waitForSelector(window, '[data-testid="memory-body-input"] strong');
      assert.equal(await window.webContents.executeJavaScript(`document.querySelector('[data-testid="memory-body-input"] table td')?.textContent`), '傍晚');
      assert.equal(await window.webContents.executeJavaScript(`document.querySelectorAll('[data-testid="memory-body-input"] ul[data-type="taskList"] input[type="checkbox"]').length`), 2);
      await window.webContents.executeJavaScript(`document.querySelector('[data-testid="memory-body-input"]').focus()`);
      await key('End', ['control']);
      await window.webContents.insertText('补记。');
      await key('Enter');
      await key('Enter');
      await window.webContents.insertText('留一行空白，接着写下今天的小事。');
      await waitUntil('editing caret remains in the visible diary scroll area', () => window.webContents.executeJavaScript(`(() => {
        const selection = document.getSelection();
        const viewport = document.querySelector('.memory-diary-scroll').getBoundingClientRect();
        if (!selection?.rangeCount) return false;
        const caret = selection.getRangeAt(0).getBoundingClientRect();
        return caret.height > 0 && caret.left >= viewport.left - 1 && caret.right <= viewport.right + 1 && caret.top >= viewport.top - 1 && caret.bottom <= viewport.bottom + 1;
      })()`));
      writeFileSync(join(projectRoot, '.test-dist', 'memory-inline-edit.png'), (await window.webContents.capturePage()).toPNG());
      await fill('[data-testid="memory-title-input"]', '有排版的日记：今天想记下的事情有很多，标题也会自然换到下一行，阅读和编辑都应该保持同样的纸面空间');
      assert.equal(await window.webContents.executeJavaScript(`(() => { const title = document.querySelector('.memory-title-input'); return title.clientHeight > Number.parseFloat(getComputedStyle(title).lineHeight) * 1.5; })()`), true, 'long titles must wrap naturally');
      await window.webContents.executeJavaScript(`document.querySelector('.memory-diary-scroll').scrollTop = 0`);
      const editedLayout = await diaryLayout(window);
      await clickSelector(window, '[data-testid="memory-save"]');
      await waitForText(window, '[data-testid="memory-detail"]', '补记');
      assert.deepEqual(await diaryLayout(window), editedLayout, 'saving edited content must keep the same line wrapping and scroll position');
      const written = memoryDatabase.readMemory(characterId, formattedDiary.entry.id).content.body;
      for (const expected of ['**粗体**', '*强调*', '~~划掉的字~~', '`行内代码`', '[x]', '[ ]', '> 一句想记住的话', '| 傍晚', '```text', '[一个链接](https://example.invalid)', '补记。']) assert.ok(written.includes(expected), `rich editing must preserve ${expected}`);
      await selectDiary('书店里的午后');
      await selectDiary('有排版的日记');
      assert.deepEqual(await diaryLayout(window), editedLayout, 'reopening saved content must preserve blank paragraphs and title wrapping');
      await clickSelector(window, '[data-testid="memory-edit"]');
      await waitForSelector(window, '[data-testid="memory-body-input"]');
      await fill('[data-testid="memory-body-input"]', '这个修改会取消。', true);
      await clickSelector(window, '[data-testid="memory-cancel"]');
      await waitForText(window, '[data-testid="memory-detail"]', '粗体');
      assert.equal(memoryDatabase.readMemory(characterId, formattedDiary.entry.id).content.body, written);
      memoryDatabase.setMemoryDiaryEnabled(characterId, true);
      memoryDatabase.queueMemoryDiaryMessage(characterId, 'memory-ui-message', Intl.DateTimeFormat().resolvedOptions().timeZone);
      const diaryWorker = createDiaryService({ database: memoryDatabase, aiRuntime: { resolveLanguageModel: () => { throw new Error('Fixture model unavailable'); } }, now: () => new Date(Date.now() + 2 * 86_400_000) });
      await diaryWorker.runOnce(); diaryWorker.dispose();
      await waitForSelector(window, '[data-testid="memory-diary-retry"]');
      await waitForText(window, '[data-testid="memory-diary-failure"]', '语言模型配置不可用');
      assert.equal(memoryDatabase.getMemoryDiaryState(characterId).failed, 1);
      await clickSelector(window, '[data-testid="memory-diary-retry"]');
      await waitUntil('manual diary retry queued', () => memoryDatabase.getMemoryDiaryState(characterId).failed === 0 && memoryDatabase.getMemoryDiaryState(characterId).pending === 1);
      await clickSelector(window, '[data-testid="memory-back"]');
      await waitForSelector(window, '[data-slot="aui_thread-viewport"]');
    });

    await runStep('offline dictation records, fills draft and cancels without changing it', async () => {
      await waitForSelector(window, '[aria-label="听写"]');
      await clickSelector(window, '[aria-label="听写"]');
      await waitForSelector(window, '[aria-label="结束听写"]');
      window.webContents.invalidate();
      await new Promise(resolve => setTimeout(resolve, 100));
      await new Promise(resolve => setTimeout(resolve, 700));
      await clickSelector(window, '[aria-label="结束听写"]');
      await waitUntil('dictation final text', () => window.webContents.executeJavaScript(`document.querySelector('[aria-label="消息输入"]').value === '这是离线语音输入。'`));
      await clickSelector(window, '[aria-label="听写"]');
      await waitForSelector(window, '[aria-label="结束听写"]');
      await clickSelector(window, '[aria-label="取消听写"]');
      await waitForSelector(window, '[aria-label="听写"]');
      assert.equal(await window.webContents.executeJavaScript(`document.querySelector('[aria-label="消息输入"]').value`), '这是离线语音输入。');
      await window.webContents.executeJavaScript(`(() => {
        const input = document.querySelector('[aria-label="消息输入"]');
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, '');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);
    });

    await runStep("play generated audio under renderer CSP", async () => {
      const audioBase64 = Buffer.from(silentWav(500)).toString("base64");
      await window.webContents.executeJavaScript(`
        new Promise((resolve, reject) => {
          const binary = atob(${JSON.stringify(audioBase64)});
          const bytes = Uint8Array.from(
            binary,
            (character) => character.charCodeAt(0),
          );
          const objectUrl = URL.createObjectURL(
            new Blob([bytes.buffer], { type: "audio/wav" }),
          );
          const audio = new Audio(objectUrl);
          const release = () => {
            audio.pause();
            audio.removeAttribute("src");
            audio.load();
            URL.revokeObjectURL(objectUrl);
          };
          audio.addEventListener("error", () => {
            const message = audio.error?.message ?? "Generated audio failed to load";
            release();
            reject(new Error(message));
          }, { once: true });
          audio.play().then(() => {
            release();
            resolve(true);
          }, (error) => {
            release();
            reject(error);
          });
        })
      `);
    });

    await runStep("stream one message", async () => {
      const listLoadsBeforeSend = completedThreadListLoads;
      await window.webContents.executeJavaScript(`(() => {
        const list = document.querySelector('[data-testid="thread-starline-scroll"]');
        window.threadListProbe = { row: list.querySelector('[data-testid="thread-starline-item"]'), flashes: 0 };
        const observer = new MutationObserver(() => {
          if (list.querySelector('[role="status"]')) window.threadListProbe.flashes += 1;
        });
        observer.observe(list, { childList: true, subtree: true });
        window.threadListProbe.observer = observer;
      })()`);
      await window.webContents.executeJavaScript(`(() => {
        const input = document.querySelector('.aui-composer-input');
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(
          input,
          '请返回测试回复',
        );
        input.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);
      await clickSelector(window, 'button[aria-label="发送消息"]');
      await waitForText(
        window,
        '[data-slot="aui_thread-viewport"]',
        "收到：",
      );
      await waitUntil("message persistence and thread metadata refresh", () => activeChatStreamCount === 0 && pendingThreadListLoads === 0 && completedThreadListLoads > listLoadsBeforeSend);
      const listRefresh = await window.webContents.executeJavaScript(`(() => {
        const probe = window.threadListProbe;
        probe.observer.disconnect();
        return { flashes: probe.flashes, originalRowRetained: probe.row.isConnected };
      })()`);
      assert.deepEqual(listRefresh, { flashes: 0, originalRowRetained: true });
    });

    await runStep("render image tools for attachment and workspace paths", async () => {
      await window.webContents.executeJavaScript(`(() => {
        const input = document.querySelector('.aui-composer-input');
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, '测试统一看图');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);
      await clickSelector(window, 'button[aria-label="发送消息"]');
      await waitForText(window, `${latestAssistant} [data-slot="tool-group-trigger"]`, '2 项工具调用');
      assert.equal(await window.webContents.executeJavaScript(`document.querySelector('${latestAssistant} [data-tool-call-id="image-original"]') === null`), true);
      assert.equal(await window.webContents.executeJavaScript(`document.querySelectorAll('${latestAssistant} [data-slot="tool-group-root"]').length`), 2, 'Assistant text must separate consecutive tool groups');
      writeFileSync(join(projectRoot, '.test-dist', 'tool-groups-collapsed.png'), (await window.webContents.capturePage()).toPNG());
      await checkToolDisclosureAnimation(window, `${latestAssistant} [data-slot="tool-group-trigger"]`, true);
      await waitForText(window, '[data-tool-call-id="image-original"]', '聊天原图.png');
      await waitForText(window, '[data-tool-call-id="image-path"]', '工作区修改图.png');
      await checkToolDisclosureAnimation(window, '[data-tool-call-id="image-original"] [data-slot="tool-fallback-trigger"]', true);
      await checkToolDisclosureAnimation(window, '[data-tool-call-id="image-original"] [data-slot="tool-fallback-trigger"]', false);
      writeFileSync(join(projectRoot, '.test-dist', 'tool-groups-expanded.png'), (await window.webContents.capturePage()).toPNG());
      await checkToolDisclosureAnimation(window, `${latestAssistant} [data-slot="tool-group-trigger"]`, false);
    });

    await runStep("preview and deliver generated files with failed command summaries", async () => {
      await window.webContents.executeJavaScript(`(() => {
        const input = document.querySelector('.aui-composer-input');
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, '测试文件交付');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);
      await clickSelector(window, 'button[aria-label="发送消息"]');
      await expandLatestToolGroup(window);
      await waitForText(window, '[data-testid="agent-action-bash"] [data-slot="tool-fallback-trigger"]', '退出码 1');
      await checkToolDisclosureAnimation(window, '[data-testid="agent-action-bash"] [data-slot="tool-fallback-trigger"]', true);
      await waitForText(window, '[data-testid="agent-action-bash"]', 'File missing');
      await checkToolDisclosureAnimation(window, '[data-testid="agent-action-bash"] [data-slot="tool-fallback-trigger"]', false);
      await waitForText(window, '[data-slot="aui_thread-viewport"]', '查看报告');
      await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('button')).find(button => button.textContent === '查看报告').click()`);
      await waitForText(window, '[data-testid="chat-file-preview"]', '文件预览测试');
      assert.deepEqual(deliveredFiles.at(-1).source, { path: 'outputs/report.txt' });
      await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[data-testid="chat-file-preview"] button')).find(button => button.textContent === '打开').click()`);
      await waitUntil('original file open requested', () => deliveredFiles.some(request => request.action === 'open' && request.source.path === 'outputs/report.txt'));
      await waitUntil('file action completed', () => window.webContents.executeJavaScript(`!document.querySelector('[data-testid="chat-file-preview"] [role="status"]')`));
      await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[data-testid="chat-file-preview"] button')).find(button => button.textContent === '另存为').click()`);
      await waitUntil('file save requested', () => deliveredFiles.some(request => request.action === 'save'));
      await window.webContents.executeJavaScript(`document.querySelector('[data-testid="chat-file-preview"] [data-slot="dialog-close"]').click()`);
      await waitUntil('file preview closed', () => window.webContents.executeJavaScript(`document.querySelector('[data-testid="chat-file-preview"]') === null`));
    });

    await runStep("render private memory tool status", async () => {
      const requestsBefore = memoryToolRequests;
      await openNewConversation(window);
      await window.webContents.executeJavaScript(`(() => {
        const input = document.querySelector('.aui-composer-input');
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(
          input,
          '测试记忆工具',
        );
        input.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);
      await clickSelector(window, 'button[aria-label="发送消息"]');
      await waitUntil('memory request reaches the stream', () => memoryToolRequests === requestsBefore + 1);
      await expandLatestToolGroup(window);
      await waitForText(
        window,
        '[data-slot="aui_thread-viewport"]',
        "搜索记忆 · 1 条",
      );
      await waitForText(
        window,
        '[data-slot="aui_thread-viewport"]',
        "读取记忆 · 2 条",
      );
      await waitForText(
        window,
        '[data-slot="aui_thread-viewport"]',
        "保存记忆 · 1 条",
      );
      await waitForText(window, '[data-slot="aui_thread-viewport"]', '遗忘记忆 · 2 条');
      await waitForText(window, '[data-slot="aui_thread-viewport"]', '版本冲突');
      await waitForText(window, '[data-slot="aui_thread-viewport"]', '已有相关记忆');
      await waitForText(window, '[data-tool-call-id="memory-get-call"]', '2 条 · 1 条未找到');
      await waitForText(window, '[data-tool-call-id="memory-forget-call"]', '2 条 · 1 条未完成');
      await waitForText(window, '[data-tool-call-id="memory-list-call"]', '查看记忆 · 2 条');
      await waitForText(window, '[data-tool-call-id="memory-empty-list-call"]', '查看记忆 · 0 条');
      assert.equal(await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[data-testid="memory-tool-status"] [data-slot="tool-fallback-trigger-label"]')).every(label => label.scrollWidth <= label.clientWidth + 1 && label.scrollHeight <= label.clientHeight + 1)`), true, 'Memory summaries must display counts and results without clipping');
      writeFileSync(join(projectRoot, '.test-dist', 'memory-tools-collapsed.png'), (await window.webContents.capturePage()).toPNG());
      await clickSelector(window, '[data-tool-call-id="memory-invalid-input"] [data-slot="tool-fallback-trigger"]');
      await waitForText(window, '[data-testid="memory-tool-status"] [role="alert"]', '记忆操作未完成');
      for (const id of ['memory-list-call', 'memory-search-call', 'memory-get-call', 'memory-save-call', 'memory-forget-call', 'memory-conflict-call', 'memory-duplicate-call']) {
        await clickSelector(window, `[data-tool-call-id="${id}"] [data-slot="tool-fallback-trigger"]`);
        await waitForText(window, `[data-tool-call-id="${id}"] [aria-label="记忆操作明细"]`, '示例人物');
      }
      await waitForText(window, '[data-tool-call-id="memory-search-call"]', '还有更多匹配');
      await waitForText(window, '[data-tool-call-id="memory-list-call"]', '第 2 页 · 共 42 条 · 还有下一页');
      await clickSelector(window, '[data-tool-call-id="memory-empty-list-call"] [data-slot="tool-fallback-trigger"]');
      await waitForText(window, '[data-tool-call-id="memory-empty-list-call"]', '第 99 页 · 共 42 条');
      await waitForText(window, '[data-tool-call-id="memory-forget-call"] [aria-label="记忆操作明细"]', '示例纪事');
      await waitForText(window, '[data-tool-call-id="memory-get-call"] [aria-label="记忆操作明细"]', '未找到');
      await window.webContents.executeJavaScript(`document.querySelector('[data-tool-call-id="memory-search-call"]').scrollIntoView({block:'start'})`);
      writeFileSync(join(projectRoot, '.test-dist', 'memory-tools-expanded.png'), (await window.webContents.capturePage()).toPNG());
      assert.equal(
        await window.webContents.executeJavaScript(`(() => {
          const text = document.querySelector('[data-slot="aui_thread-viewport"]')?.textContent ?? '';
          return [
            '不应显示的搜索词',
            '不应显示的记忆正文',
            '不应显示的读取正文',
            '不应显示的保存正文',
            '不应显示的错误参数正文',
          ].some((secret) => text.includes(secret));
        })()`),
        false,
      );
      await waitUntil(
        "memory response stream completion",
        () => activeChatStreamCount === 0,
      );
      assert.equal(memoryToolRequests, requestsBefore + 1, 'Memory UI checks must send exactly one request');
      await waitForSelector(window, 'button[aria-label="发送消息"]');
    });

    await runStep("signed directory approval resumes through the existing assistant runtime", async () => {
      await openNewConversation(window);
      await waitForSelector(window, '.aui-composer-input');
      await window.webContents.executeJavaScript(`(() => {
        const input = document.querySelector('.aui-composer-input');
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, '测试目录批准');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);
      await clickSelector(window, 'button[aria-label="发送消息"]');
      await waitForText(window, '[data-testid="directory-access-request"]', '批准');
      writeFileSync(join(projectRoot, '.test-dist', 'agent-directory-approval.png'), (await window.webContents.capturePage()).toPNG());
      await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[data-testid="directory-access-request"] button')).find(button => button.textContent === '批准').click()`);
      await waitForText(window, '[data-slot="aui_thread-viewport"]', '目录批准已继续');
      assert.equal(directoryApprovalResponses, 1);
      await openNewConversation(window);
    });
    await runStep("backend tool-only completion does not restart the Agent in the renderer", async () => {
      await window.webContents.executeJavaScript(`(() => {
        const input = document.querySelector('.aui-composer-input');
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, '测试工具终态');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);
      await clickSelector(window, 'button[aria-label="发送消息"]');
      await waitUntil("tool-only stream completion", () => toolOnlyRequests > 0 && activeChatStreamCount === 0);
      await waitForSelector(window, 'button[aria-label="发送消息"]');
      await window.webContents.executeJavaScript('new Promise(resolve => setTimeout(resolve, 200))');
      assert.equal(toolOnlyRequests, 1, "Backend tools must be continued only by Main's native Agent loop");
    });

    await runStep("web access approval is visible and resumes the same conversation", async () => {
      await openNewConversation(window);
      await waitForSelector(window, '.aui-composer-input');
      await window.webContents.executeJavaScript(`(() => {
        const input = document.querySelector('.aui-composer-input');
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, '测试网页批准');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);
      await clickSelector(window, 'button[aria-label="发送消息"]');
      await waitForText(window, '[data-slot="tool-fallback-approval"]', '批准');
      await waitForText(window, '[data-slot="tool-group-trigger"]', '2 项工具调用 · 等待批准');
      assert.equal(await window.webContents.executeJavaScript(`document.querySelector('[data-slot="tool-group-trigger"]').getAttribute('aria-expanded')`), 'true');
      await waitForText(window, '[data-testid="agent-action-fetch"]', 'https://example.com');
      await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[data-slot="tool-fallback-approval"] button')).find(button=>button.textContent.trim()==='批准').click()`);
      await waitForText(window, '[data-slot="aui_thread-viewport"]', '网页批准已继续');
      assert.equal(webApprovalResponses, 1);
      await waitUntil('settled approval removes active controls', () => window.webContents.executeJavaScript(`document.querySelector('[data-slot="tool-fallback-approval"]') === null`));
      await openNewConversation(window);
    });

    await runStep("render performance summary and authoritative playback state", async () => {
      await window.webContents.executeJavaScript(`(() => {
        const input = document.querySelector('.aui-composer-input');
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, '测试表演编排');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);
      await clickSelector(window, 'button[aria-label="发送消息"]');
      await expandLatestToolGroup(window);
      await waitForText(window, '[data-testid="avatar-performance"]', '已安排');
      for (const [id, error] of [['performance-ui-error', '角色编排队列已满'], ['performance-ui-invalid', '故障编号：synthetic-validation']]) {
        const selector = `[data-tool-call-id="${id}"]`;
        await waitForText(window, selector, '表演失败');
        assert.equal(await window.webContents.executeJavaScript(`document.querySelector('${selector} [role="alert"]')===null`), true, 'Failed tools initially show a compact summary');
        await clickSelector(window, `${selector} button`);
        await waitForText(window, `${selector} [role="alert"]`, error);
        await clickSelector(window, `${selector} button`);
        await waitUntil('failed tool details collapse', () => window.webContents.executeJavaScript(`document.querySelector('${selector} [role="alert"]')===null && document.querySelector('${selector} button').getAttribute('aria-expanded')==='false'`));
        await waitForText(window, selector, '表演失败');
        await clickSelector(window, `${selector} button`);
        await waitForText(window, `${selector} [role="alert"]`, error);
        await clickSelector(window, `${selector} button`);
      }
      await waitForText(window, '[data-tool-call-id="performance-ui-ack"]', '已安排');
      await clickSelector(window, '[data-tool-call-id="performance-ui-ack"] button');
      await waitForText(window, '[data-tool-call-id="performance-ui-ack"]', '开心');
      await waitForText(window, '[data-tool-call-id="performance-ui-state-only"]', '播放状态未同步');
      assert.equal(await window.webContents.executeJavaScript(`document.querySelector('[data-testid="avatar-performance"]').textContent.includes('表演完成')`), false);
      await clickSelector(window, '[data-testid="avatar-performance"] button');
      await waitForText(window, '[data-testid="avatar-performance"]', '问候');
      await waitForText(window, '[data-testid="avatar-performance"]', '第 2 句');
      await waitForText(window, '[data-testid="avatar-performance"]', '鼓掌');
      const performance = { performanceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', toolCallId: 'performance-ui', state: 'running', cues: [
        { id: 'step-1', state: 'running' }, { id: 'step-2', state: 'pending' }, { id: 'step-3', state: 'pending' },
      ] };
      window.webContents.send('avatar:changed', { ...avatarStatus, performances: [performance,
        { performanceId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', toolCallId: 'performance-ui-state-only', state: 'running', cues: [{ id: 'step-1', state: 'running' }] },
      ] });
      await waitForText(window, '[data-testid="avatar-performance"]', '正在表演');
      await waitForText(window, '[data-tool-call-id="performance-ui-state-only"]', '正在表演');
      await window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
      writeFileSync(join(projectRoot, '.test-dist', 'avatar-performance-ui.png'), (await window.webContents.capturePage()).toPNG());
      window.webContents.send('avatar:changed', { ...avatarStatus, performances: [{ ...performance, state: 'failed', error: '测试播放失败' }] });
      await waitForText(window, '[data-testid="avatar-performance"] [role="alert"]', '测试播放失败');
      // The status update can move the trigger while the viewport is anchoring.
      // Activate the located trigger directly; keep the panel lifecycle checks.
      await window.webContents.executeJavaScript(`document.querySelector('[data-tool-call-id="performance-ui"] button').click()`);
      await waitUntil('playback failure collapses with its steps', () => window.webContents.executeJavaScript(`document.querySelector('[data-tool-call-id="performance-ui"] [role="alert"]')===null && document.querySelector('[data-tool-call-id="performance-ui"] li')===null`));
      await waitForText(window, '[data-tool-call-id="performance-ui"]', '表演失败');
      await clickSelector(window, '[data-tool-call-id="performance-ui"] button');
      await waitForText(window, '[data-tool-call-id="performance-ui"] [role="alert"]', '测试播放失败');
      window.webContents.send('avatar:changed', avatarStatus);
      await waitForText(window, '[data-tool-call-id="dance-ui"]', '舞蹈已安排');
      await waitForText(window, '[data-tool-call-id="dance-ui"]', '测试舞蹈');
      assert.equal(await window.webContents.executeJavaScript(`document.querySelector('[data-tool-call-id="dance-ui"] button') === null && document.querySelector('[data-tool-call-id="dance-ui"] [data-slot="tool-fallback-content"]') === null`), true, 'Successful dance status has no empty disclosure');
      await clickSelector(window, '[data-tool-call-id="dance-ui-error"] [data-slot="tool-fallback-trigger"]');
      await waitForText(window, '[data-tool-call-id="dance-ui-error"] [role="alert"]', '舞蹈伴奏无法加载');
      const dance = { performanceId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', toolCallId: 'dance-ui', actionId: '11111111-1111-4111-8111-111111111111', action: '测试舞蹈', state: 'started' };
      window.webContents.send('avatar:changed', { ...avatarStatus, dance: { ...dance, state: 'preparing' } });
      await waitForText(window, '[data-tool-call-id="dance-ui"]', '正在准备舞蹈');
      window.webContents.send('avatar:changed', { ...avatarStatus, dance });
      await waitForText(window, '[data-tool-call-id="dance-ui"]', '正在表演');
      window.webContents.send('avatar:changed', { ...avatarStatus, dance: { ...dance, state: 'completed' } });
      await waitForText(window, '[data-tool-call-id="dance-ui"]', '舞蹈已完成');
      window.webContents.send('avatar:changed', { ...avatarStatus, dance: { ...dance, state: 'cancelled' } });
      await waitForText(window, '[data-tool-call-id="dance-ui"]', '舞蹈已停止');
      window.webContents.send('avatar:changed', avatarStatus);
      await waitUntil('performance response stream completion', () => activeChatStreamCount === 0);
      await waitForSelector(window, 'button[aria-label="发送消息"]');
    });

    await runStep("import attachments from picker, drop, and clipboard", async () => {
      await waitForSelector(window, 'button[aria-label="添加附件"]');
      await window.webContents.executeJavaScript(`(() => {
        const originalClick = HTMLInputElement.prototype.click;
        HTMLInputElement.prototype.click = function () {
          if (this.type !== 'file') return originalClick.call(this);
          const transfer = new DataTransfer();
          transfer.items.add(new File(['picker'], '选择文件.txt', { type: 'text/plain' }));
          Object.defineProperty(this, 'files', { configurable: true, value: transfer.files });
          this.dispatchEvent(new Event('change', { bubbles: true }));
          HTMLInputElement.prototype.click = originalClick;
        };
      })()`);
      await clickSelector(window, 'button[aria-label="添加附件"]');
      await waitUntil(
        "picker attachment import",
        () => importedAttachmentRequests.length === 1,
      );
      await waitForSelector(window, ".aui-composer-attachments .aui-attachment-root");
      await clickSelector(window, ".aui-composer-attachments .aui-attachment-tile-remove");
      await waitUntil(
        "picker attachment release",
        () => releasedAttachmentIds.includes(importedAttachmentIds[0]),
      );

      await window.webContents.executeJavaScript(`(() => {
        const transfer = new DataTransfer();
        transfer.items.add(new File(['drop'], '拖拽文件.bin'));
        document.querySelector('[data-slot="aui_composer-shell"]').dispatchEvent(
          new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }),
        );
      })()`);
      await waitUntil(
        "drop attachment import",
        () => importedAttachmentRequests.length === 2,
      );
      await waitForSelector(window, ".aui-composer-attachments .aui-attachment-root");
      await clickSelector(window, ".aui-composer-attachments .aui-attachment-tile-remove");
      await waitUntil(
        "drop attachment release",
        () => releasedAttachmentIds.includes(importedAttachmentIds[1]),
      );

      await waitForSelector(window, ".aui-composer-input");
      await window.webContents.executeJavaScript(`(() => {
        const transfer = new DataTransfer();
        transfer.items.add(new File(['paste'], '粘贴文件.dat'));
        document.querySelector('.aui-composer-input').dispatchEvent(
          new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer }),
        );
      })()`);
      await waitUntil(
        "clipboard attachment import",
        () => importedAttachmentRequests.length === 3,
      );
      await waitForSelector(window, ".aui-composer-attachments .aui-attachment-root");
      assert.equal(importedAttachmentRequests[1].mediaType, "application/octet-stream");
      assert.deepEqual(
        [...importedAttachmentRequests[2].data],
        [...new TextEncoder().encode("paste")],
      );

      await window.webContents.executeJavaScript(`(() => {
        const input = document.querySelector('.aui-composer-input');
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(
          input,
          '请读取附件',
        );
        input.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);
      await clickSelector(window, 'button[aria-label="发送消息"]');
      await waitUntil(
        "attachment message persistence",
        () =>
          appendedMessageRequests.some((request) =>
            request.assetIds?.includes(importedAttachmentIds[2]),
          ),
      );
      const appendedMessageRequest = appendedMessageRequests.find((request) =>
        request.assetIds?.includes(importedAttachmentIds[2]),
      );
      assert.ok(appendedMessageRequest);
      assert.match(
        JSON.stringify(appendedMessageRequest.message.content),
        new RegExp(`katarune-asset://asset/${importedAttachmentIds[2]}`),
      );
      await waitUntil('sent attachment card rendered', () => window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.aui-user-message-attachments-end button')).some(button => button.textContent.includes('粘贴文件.dat'))`));
      await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.aui-user-message-attachments-end button')).find(button => button.textContent.includes('粘贴文件.dat')).click()`);
      await waitForText(window, '[data-testid="chat-file-preview"]', '文件预览测试');
      assert.deepEqual(deliveredFiles.at(-1).source, { attachmentId: importedAttachmentIds[2] });
      assert.equal(await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[data-testid="chat-file-preview"] button')).some(button => button.textContent === '打开')`), false);
      await window.webContents.executeJavaScript(`document.querySelector('[data-testid="chat-file-preview"] [data-slot="dialog-close"]').click()`);
      await waitUntil('attachment preview closed', () => window.webContents.executeJavaScript(`document.querySelector('[data-testid="chat-file-preview"]') === null`));
    });

    await runStep("queue avatar dialogue without interrupting or restarting the Agent", async () => {
      const subtitleStart = avatarUserSubtitles.length;
      await waitUntil("previous chat complete", () => activeChatStreamCount === 0);
      await openNewConversation(window);
      await waitForSelector(window, ".aui-thread-welcome-root");
      await clickSelector(window, '[data-testid="avatar-toggle"]');
      await waitForText(window, '[data-testid="avatar-toggle"]', "停止桌宠");
      assert.equal(threads.some(t => t.remoteId === avatarStatus.binding.threadId), false, "Connecting the avatar must not persist an empty thread");
      const sendText = async (text, enter = false) => {
        await window.webContents.executeJavaScript(`(() => {
          const input = document.querySelector('.aui-composer-input');
          Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, ${JSON.stringify(text)});
          input.dispatchEvent(new Event('input', { bubbles: true }));
        })()`);
        if (enter) await window.webContents.executeJavaScript(`document.querySelector('.aui-composer-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }))`);
        else await clickSelector(window, 'button[aria-label="发送消息"]');
      };
      await sendText("桌宠第一句");
      await waitForText(window, '[data-slot="aui_thread-viewport"]', "字幕对白第1句");
      // The capsule uses the same active runtime and queue even when the main
      // window is hidden. A stale target must never fall through to this thread.
      const capsuleText = async (id, binding, text) => {
        const reply = new Promise(resolve => {
          const listener = (event, result) => {
            if (event.sender !== window.webContents || result.id !== id) return;
            ipcMain.removeListener("avatar:text-result", listener);
            resolve(result);
          };
          ipcMain.on("avatar:text-result", listener);
        });
        window.webContents.send("avatar:text-input", { id, binding, text });
        return reply;
      };
      const stale = await capsuleText("00000000-0000-4000-8000-000000000021", { ...avatarStatus.binding, threadId: "old-thread" }, "不应发送");
      assert.ok(stale.error);
      const accepted = await capsuleText("00000000-0000-4000-8000-000000000022", avatarStatus.binding, "桌宠第二句");
      assert.equal(accepted.error, null);
      assert.equal(window.isVisible(), false, "Capsule text must not open the chat window");
      await waitForText(window, '[role="status"]:not(.sr-only)', "1");
      await sendText("桌宠第三句", true);
      await waitForText(window, '[role="status"]:not(.sr-only)', "2");
      assert.equal(avatarChatRequests.length, 1);
      assert.deepEqual(avatarUserSubtitles.slice(subtitleStart), [{ binding: avatarStatus.binding, text: "桌宠第一句" }]);
      assert.equal(canceledAvatarStreams, 0);
      assert.equal(await window.webContents.executeJavaScript(`document.querySelector('button[aria-label="停止回复"]') === null`), true);
      releaseAvatarOutput();
      await waitForText(window, '[data-slot="aui_thread-viewport"]', "字幕对白第3句");
      await waitUntil("avatar stream completed", () => activeChatStreamCount === 0);
      assert.equal(avatarChatRequests.length, 3);
      assert.deepEqual(avatarUserSubtitles.slice(subtitleStart), ["桌宠第一句", "桌宠第二句", "桌宠第三句"].map(text => ({ binding: avatarStatus.binding, text })));
      await waitUntil("avatar thread gets a native title after its first reply", () => titleRequests.some(r => r.threadId === avatarChatRequests[0].threadId));
      assert.equal(titleRequests.filter(r => r.threadId === avatarChatRequests[0].threadId).length, 1);
      await waitForText(window, "body", "测试会话：桌宠第一句");
      assert.equal(canceledAvatarStreams, 0);
      assert.equal(avatarChatRequests[1].messages.at(-1).parts[0].text, "桌宠第二句");
      assert.equal(avatarChatRequests[2].messages.at(-1).parts[0].text, "桌宠第三句");
      const rendered = await window.webContents.executeJavaScript(`document.querySelector('[data-slot="aui_thread-viewport"]').textContent`);
      assert.equal(rendered.split("字幕对白第1句").length - 1, 1);
      await waitUntil("native text history persisted", () => JSON.stringify([...storedMessages.values()]).includes("字幕对白第3句"));
      await clickSelector(window, '[data-testid="avatar-toggle"]');
      await waitForText(window, '[data-testid="avatar-toggle"]', "开启桌宠");
      await openNewConversation(window);
      await waitForSelector(window, ".aui-thread-welcome-root");
      await sendText("普通新会话标题");
      await waitUntil("ordinary thread title generated", () => titleRequests.some(r => r.messages[0]?.text === "普通新会话标题"));
      await waitForText(window, "body", "测试会话：普通新会话标题");
      await waitUntil("ordinary chat completed", () => activeChatStreamCount === 0);
      assert.equal(titleRequests.filter(r => r.messages[0]?.text === "普通新会话标题").length, 1);
      assert.equal(avatarUserSubtitles.length, subtitleStart + 3, "Stopped avatar must not receive typed captions");
    });

    await runStep("missing inherited defaults preserve selection and settings navigation", async () => {
      includeGoogleSpeechFixture = true;
      await clickSelector(window, '[data-testid="character-launcher"]');
      await waitForSelector(window, '[data-testid="character-page"]');
      const choose = async (testId, text) => {
        await waitForSelector(window, `[data-testid="${testId}"]`);
        await clickSelector(window, `[data-testid="${testId}"]`);
        await waitForSelector(window, '[data-slot="model-selector-content"]');
        await window.webContents.executeJavaScript(`(() => {
          const item = [...document.querySelectorAll('[data-slot="model-selector-item"]')].find(item => item.textContent.includes(${JSON.stringify(text)}));
          if (!item) throw new Error('Missing option'); item.click();
        })()`);
        await waitUntil('selection menu closed', async () => window.webContents.executeJavaScript(`!document.querySelector('[data-slot="model-selector-content"]')`));
      };
      await choose('character-model', '默认');
      await waitUntil('language inheritance saved', () => character.modelConfigId === null);
      await waitForText(window, '[data-testid="character-model"]', '无');
      await choose('character-speech-model', '默认');
      await waitUntil('speech inheritance saved', () => character.useDefaultSpeechModel);
      await waitForText(window, '[data-testid="character-speech-model"]', '无');
      await waitForText(window, '[data-testid="character-speech-voice"]', '无');
      await waitForSelector(window, '[data-testid="character-speech-model"] + button[aria-label="前往模型设置"]');
      await clickSelector(window, '[data-testid="character-model"] + button[aria-label="前往模型设置"]');
      await waitForSelector(window, '[data-testid="model-management"]');
      assert.equal(await window.webContents.executeJavaScript(`document.querySelector('[data-slot="model-selector-content"]')`), null);
      await clickSelector(window, '[data-testid="settings-back"]');
      await waitForSelector(window, '[data-testid="character-launcher"]');
      await clickSelector(window, '[data-testid="character-launcher"]');
      await waitForSelector(window, '[data-testid="character-model"]');
      // An absent default must not prevent selecting an existing explicit model.
      await choose('character-model', 'DeepSeek Chat');
      await waitUntil('explicit model restored', () => character.modelConfigId === modelId);
      await choose('character-speech-model', 'Custom Voice TTS');
      await waitUntil('speech model without default voice selected', () => character.speechModelConfigId === manualSpeechModelId);
      await waitForText(window, '[data-testid="character-speech-voice"]', '无');
      await waitForSelector(window, '[data-testid="character-speech-voice"] + button[aria-label="前往模型设置"]');
      await clickSelector(window, '[data-testid="character-speech-voice"]');
      await waitForSelector(window, '[aria-label="搜索音色或输入 Voice ID"]');
      await window.webContents.executeJavaScript(`document.querySelector('[aria-label="搜索音色或输入 Voice ID"]').focus()`);
      await window.webContents.insertText('character-voice-123');
      await waitForText(window, '[data-slot="model-selector-list"]', '使用 Voice ID：character-voice-123');
      window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
      window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
      await waitUntil('custom character voice saved', () => character.speechVoice === 'character-voice-123' && !character.useDefaultSpeechVoice);
      await waitUntil('voice menu closed', async () => window.webContents.executeJavaScript(`!document.querySelector('[data-slot="model-selector-content"]')`));
      await waitForText(window, '[data-testid="character-speech-voice"]', 'character-voice-123');
      assert.equal(await window.webContents.executeJavaScript(`document.querySelector('[data-testid="character-speech-voice"] + button')`), null);
      await clickSelector(window, '[data-testid="character-back"]');
      await waitForSelector(window, '[data-testid="character-launcher"]');
    });

    await runStep("bind character speech model", async () => {
      includeGoogleSpeechFixture = true;
      await clickSelector(window, '[data-testid="character-launcher"]');
      await waitForSelector(window, '[data-testid="character-page"]');
      await waitForText(window, '[data-testid="character-page"]', "测试角色 A");
      await window.webContents.executeJavaScript(`(() => {
        const button = document.querySelector('[data-testid="character-portrait-import"]');
        if (!button) throw new Error('Missing package button'); button.click();
      })()`);
      await waitForSelector(window, '[data-testid="character-package-dialog"]');
      await waitForText(window, '[data-testid="character-package-dialog"]', "春原心奈");
      const packageActionNames = () => window.webContents.executeJavaScript(`
        [...document.querySelectorAll('.character-package-actions [role="tabpanel"] li')].map(item => item.textContent)
      `);
      assert.deepEqual(await packageActionNames(), ["问候"]);
      assert.deepEqual(await window.webContents.executeJavaScript(`
        [...document.querySelectorAll('.character-package-actions [role="tab"]')].map(tab => tab.textContent.trim())
      `), ["单次1", "循环1", "演出1"]);
      await clickSelector(window, '.character-package-actions [role="tab"]:nth-child(2)');
      await waitForText(window, '.character-package-actions [role="tabpanel"]', "基础待机");
      assert.deepEqual(await packageActionNames(), ["基础待机"]);
      await clickSelector(window, '.character-package-actions [role="tab"]:nth-child(3)');
      await waitForText(window, '.character-package-actions [role="tabpanel"]', "测试舞蹈");
      assert.deepEqual(await packageActionNames(), ["测试舞蹈"]);
      writeFileSync(join(projectRoot, '.test-dist', 'character-package-tabs.png'), (await window.webContents.capturePage()).toPNG());
      assert.equal(await window.webContents.executeJavaScript(`(() => {
        const dialog = document.querySelector('[data-testid="character-package-dialog"]');
        const remove = [...dialog.querySelectorAll('button')].find(b => b.textContent.trim() === '删除');
        return remove.disabled;
      })()`), true);
      await window.webContents.executeJavaScript(`document.querySelector('[data-testid="character-package-dialog"] button').focus()`);
      await window.webContents.executeJavaScript(`(() => { [...document.querySelectorAll('[data-testid="character-package-dialog"] button')].find(b => b.textContent.trim() === '取消').click(); })()`);
      await waitUntil("package dialog closed", async () => window.webContents.executeJavaScript(`!document.querySelector('[data-testid="character-package-dialog"]')`));
      const openPackages = async () => {
        await window.webContents.executeJavaScript(`document.querySelector('[data-testid="character-portrait-import"]').click()`);
        await waitForSelector(window, '.character-package-option');
      };
      const selectPackage = async (name) => {
        await window.webContents.executeJavaScript(`(() => { [...document.querySelectorAll('.character-package-option')].find(b => b.textContent.includes(${JSON.stringify(name)})).click(); })()`);
        await waitForText(window, '.character-package-detail h3', name);
      };
      const packageButton = async (name) => window.webContents.executeJavaScript(`(() => { [...document.querySelectorAll('[data-testid="character-package-dialog"] button')].find(b => b.textContent.trim() === ${JSON.stringify(name)}).click(); })()`);
      const packageClosed = async () => waitUntil("package dialog closed", async () => window.webContents.executeJavaScript(`!document.querySelector('[data-testid="character-package-dialog"]')`));
      await openPackages();
      await selectPackage("测试角色包");
      await waitForText(window, '.character-package-actions [role="tabpanel"]', "暂无此类动作");
      assert.equal(await window.webContents.executeJavaScript(`document.querySelector('.character-package-actions [role="tab"][aria-selected="true"]').textContent.trim()`), "单次0");
      assert.equal(character.packageId, "builtin:default");
      await packageButton("取消");
      await packageClosed();
      assert.equal(character.packageId, "builtin:default");
      await openPackages();
      await selectPackage("测试角色包");
      await packageButton("使用");
      await packageClosed();
      assert.equal(character.packageId, "00000000-0000-4000-8000-000000000031");
      await openPackages();
      await waitForText(window, '.character-package-detail h3', "测试角色包");
      assert.equal(await window.webContents.executeJavaScript(`(() => { const remove = [...document.querySelectorAll('[data-testid="character-package-dialog"] button')].find(b => b.textContent.trim() === '删除'); return remove.disabled && remove.title.includes('先更换'); })()`), true);
      await selectPackage("春原心奈");
      await packageButton("使用");
      await packageClosed();
      assert.equal(character.packageId, "builtin:default");
      await openPackages();
      await selectPackage("测试角色包");
      await packageButton("删除");
      await waitUntil("unreferenced package deleted", async () => window.webContents.executeJavaScript(`![...document.querySelectorAll('.character-package-option')].some(b => b.textContent.includes('测试角色包'))`));
      await packageButton("导入");
      await waitUntil("canceled import finished", async () => window.webContents.executeJavaScript(`![...document.querySelectorAll('[data-testid="character-package-dialog"] button')].find(b => b.textContent.trim() === '导入').disabled`));
      assert.equal(character.packageId, "builtin:default");
      await packageButton("取消");
      await packageClosed();
      await clickSelector(window, '[data-testid="character-speech-model"]');
      await waitForSelector(window, '[data-slot="model-selector-content"]');
      await window.webContents.executeJavaScript(`(() => {
        const item = [...document.querySelectorAll('[data-slot="model-selector-item"]')]
          .find((candidate) => candidate.textContent.includes('Gemini 2.5 Flash TTS'));
        if (item === undefined) throw new Error('Google Gemini TTS option was not found');
        item.click();
      })()`);
      await waitUntil(
        "Google speech model binding",
        () =>
          updatedCharacterRequest?.speechModelConfigId === googleSpeechModelId &&
          updatedCharacterRequest?.useDefaultSpeechVoice === true,
      );
      await waitForText(window, '[data-testid="character-speech-voice"]', "默认");
      await waitForText(window, '[data-testid="character-speech-voice"]', "Kore");
      includeGoogleSpeechFixture = false;
      await clickSelector(window, '[data-testid="character-back"]');
      await waitForSelector(window, '[data-slot="aui_thread-viewport"]');
    });

    await runStep("use general settings", async () => {
      includeGoogleSpeechFixture = true;
      await clickSelector(window, '[data-testid="settings-launcher"]');
      await waitForSelector(window, '[data-testid="settings-page"]');
      await waitForSelector(window, '[data-testid="general-settings"]');
      await clickSelector(window, '[data-testid="theme-dark"]');
      await waitForSelector(window, "html.dark");
      if (process.platform === "win32") {
        await waitUntil("native title bar follows dark theme", () => String(window.getAccentColor()).toLowerCase() === "#0a0a0a");
      }
      await clickSelector(window, '[data-testid="reduce-motion"]');
      await waitForSelector(window, 'html[data-reduce-motion]');
      await clickSelector(window, '[data-testid="auto-read-replies"]');
      await waitUntil("preferences saved", async () => window.webContents.executeJavaScript(`localStorage.getItem("katarune.autoReadReplies") === "true" && localStorage.getItem("katarune.reduceMotion") === "true"`));
      await clickSelector(window, '[data-testid="default-language-model"]');
      await waitForSelector(window, '[data-slot="model-selector-content"]');
      await window.webContents.executeJavaScript(`(() => {
        const item = [...document.querySelectorAll('[data-slot="model-selector-item"]')]
          .find((candidate) => candidate.textContent.includes('DeepSeek Chat'));
        if (item === undefined) throw new Error('Default language model option was not found');
        item.click();
      })()`);
      await waitUntil(
        "application default model update",
        () => appSettings.defaultLanguageModelConfigId === modelId,
      );
    });

    await runStep("default speech dual selection and global ASR", async () => {
      const choose = async (testId, text) => {
        console.log(`[defaults] ${testId}: ${text}`);
        await waitUntil("selector enabled", async () => window.webContents.executeJavaScript(`document.querySelector('[data-testid="${testId}"]')?.disabled === false`));
        await clickSelector(window, `[data-testid="${testId}"]`);
        await waitForSelector(window, '[data-slot="model-selector-content"]');
        const found = await window.webContents.executeJavaScript(`(() => {
          const item = [...document.querySelectorAll('[data-slot="model-selector-item"]')].find(item => item.textContent.includes(${JSON.stringify(text)}));
          if (!item) { console.error('Missing option: ' + document.querySelector('[data-slot="model-selector-content"]')?.textContent); return false; } item.click(); return true;
        })()`);
        if (!found) throw new Error('Missing option ' + text + ': ' + await window.webContents.executeJavaScript(`document.body.innerText.slice(-2500)`));
        await waitUntil('selection menu closed', async () => window.webContents.executeJavaScript(`document.querySelector('[data-slot="model-selector-content"]') === null`));
      };
      await waitForText(window, '[data-testid="default-speech-model"]', "无");
      await waitForText(window, '[data-testid="default-speech-voice"]', "请选择模型");
      await clickSelector(window, '[data-testid="default-speech-model"]');
      await waitForSelector(window, '[data-slot="model-selector-content"]');
      window.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
      window.webContents.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
      await waitUntil('available unselected menu closed', async () => window.webContents.executeJavaScript(`!document.querySelector('[data-slot="model-selector-content"]')`));
      await clickSelector(window, '[data-testid="default-asr-model"]');
      await waitForSelector(window, '[data-slot="model-selector-content"]');
      assert.deepEqual(await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[data-slot="model-selector-item"]')).map(item => item.textContent)`), ['SenseVoiceSmall INT8']);
      window.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
      window.webContents.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
      await waitUntil('ASR menu closed', async () => window.webContents.executeJavaScript(`!document.querySelector('[data-slot="model-selector-content"]')`));
      await choose("default-speech-model", "Gemini 2.5 Flash TTS");
      await waitUntil("default speech configured", () => appSettings.defaultSpeechVoice === "Kore");
      await clickSelector(window, '[data-testid="default-speech-voice"]');
      await waitForSelector(window, '[aria-label="搜索音色或输入 Voice ID"]');
      await window.webContents.executeJavaScript(`document.querySelector('[aria-label="搜索音色或输入 Voice ID"]').focus()`);
      await window.webContents.insertText("custom-voice-123");
      await waitForText(window, '[data-slot="model-selector-list"]', "使用 Voice ID：custom-voice-123");
      window.webContents.sendInputEvent({ type: "keyDown", keyCode: "Return" });
      window.webContents.sendInputEvent({ type: "keyUp", keyCode: "Return" });
      await waitUntil("custom voice committed through the same control", () => appSettings.defaultSpeechVoice === "custom-voice-123");
      await waitUntil("voice menu closed", async () => window.webContents.executeJavaScript(`!document.querySelector('[data-slot="model-selector-content"]')`));
      await choose("default-speech-voice", "Puck");
      await waitUntil("default voice updated", () => appSettings.defaultSpeechVoice === "Puck");
      await waitForText(window, '[data-testid="default-asr-model"]', "SenseVoiceSmall INT8");
      await clickSelector(window, '[data-testid="settings-back"]');
      await waitForSelector(window, '[data-slot="aui_thread-viewport"]');
      await waitForSelector(window, '[data-testid="dictation-toggle"]');
      await clickSelector(window, '[data-testid="character-launcher"]');
      await waitForSelector(window, '[data-testid="character-page"]');
      await choose("character-model", "默认");
      await choose("character-speech-model", "默认");
      await waitUntil("character inherits speech model", () => updatedCharacterRequest?.useDefaultSpeechModel === true);
      await waitForText(window, '[data-testid="character-model"]', "默认");
      await waitForText(window, '[data-testid="character-model"]', "DeepSeek Chat");
      await waitForText(window, '[data-testid="character-speech-model"]', "默认");
      await waitForText(window, '[data-testid="character-speech-model"]', "Gemini 2.5 Flash TTS");
      await waitForText(window, '[data-testid="character-speech-voice"]', "默认");
      await waitForText(window, '[data-testid="character-speech-voice"]', "Puck");
      await clickSelector(window, '[data-testid="character-back"]');
      await waitForSelector(window, '[data-testid="settings-launcher"]');
      includeGoogleSpeechFixture = false;
      await clickSelector(window, '[data-testid="settings-launcher"]');
      await waitForSelector(window, '[data-testid="general-settings"]');
      await choose("default-asr-model", "SenseVoiceSmall INT8");
      await waitUntil("ASR enabled globally", () => appSettings.defaultAsrModel === "sensevoice-small-int8");
      await waitForText(window, '[data-testid="default-speech-model"]', "所选模型不可用");
      await clickSelector(window, '[data-testid="default-speech-model"]');
      await waitForSelector(window, '[data-testid="model-management"]');
      assert.equal(await window.webContents.executeJavaScript(`document.querySelector('[data-slot="model-selector-content"]')`), null);
      await clickSelector(window, '[data-testid="settings-tab-general"]');
      await waitForSelector(window, '[data-testid="default-speech-model"]');
      includeGoogleSpeechFixture = false;
    });

    await runStep("automatic desktop voice, full-duplex capture and background binding", async () => {
      testingRealtime = true; includeGoogleSpeechFixture = true;
      await clickSelector(window, '[data-testid="settings-back"]');
      await waitForSelector(window, '[data-testid="dictation-toggle"]');
      await new Promise(resolve => setTimeout(resolve, 300));
      if (avatarStatus.phase !== 'ready') {
        await clickSelector(window, '[data-testid="avatar-toggle"]');
        await waitUntil('avatar connected for voice', () => avatarStatus.phase === 'ready');
      }
      const bound = { ...avatarStatus.binding };
      const beforeOrdinary = ordinaryPrepareCount;
      await waitUntil('automatic microphone start', () => realtimePrepareCount >= 1);
      assert.equal(ordinaryPrepareCount, beforeOrdinary);
      await waitUntil('AudioWorklet frames', () => realtimeFrameCount >= 2);
      assert.equal(await window.webContents.executeJavaScript(`document.querySelector('[data-testid="dictation-toggle"]').disabled`), true);
      const beforeMessages = avatarChatRequests.length;
      const draft = await window.webContents.executeJavaScript(`document.querySelector('[aria-label="消息输入"]').value`);
      realtimeText = '这是实时语音对话。';
      await waitUntil('recognized utterance automatically sent', () => avatarChatRequests.length === beforeMessages + 1);
      assert.equal(avatarUserSubtitles.filter(request => request.text === '这是实时语音对话。').length, 1, 'Voice caption must not be duplicated by the send queue');
      const request = avatarChatRequests.at(-1);
      assert.equal(request.threadId, bound.threadId); assert.equal(request.characterId, bound.characterId);
      assert.match(JSON.stringify(request.messages), /这是实时语音对话/);
      const busyFrames = realtimeFrameCount;
      await waitUntil('capture continues while avatar is busy', () => realtimeFrameCount > busyFrames + 2);
      assert.equal(await window.webContents.executeJavaScript(`document.querySelector('[aria-label="消息输入"]').value`), draft);
      await clickSelector(window, '[data-testid="settings-launcher"]');
      await waitForSelector(window, '[data-testid="general-settings"]');
      avatarStatus = { ...avatarStatus, busy: false };
      window.webContents.send('avatar:changed', avatarStatus);
      await waitUntil('listening continues while settings page is open', () => realtimeFrameCount > busyFrames + 4);
      await clickSelector(window, '[data-testid="settings-back"]');
      avatarStatus = { ...avatarStatus, voice: { desired: false, phase: 'idle', error: null } };
      window.webContents.send('avatar:changed', avatarStatus);
      await waitUntil('microphone stopped from HUD intent', async () => window.webContents.executeJavaScript(`document.querySelector('[data-testid="dictation-toggle"]').disabled === false`));
      const endedAt = realtimeFrameCount;
      await new Promise(resolve => setTimeout(resolve, 350)); assert.equal(realtimeFrameCount, endedAt);
      avatarStatus = { ...avatarStatus, voice: { desired: true, phase: 'preparing', error: null } };
      window.webContents.send('avatar:changed', avatarStatus);
      await waitUntil('microphone restarts from HUD intent', () => realtimePrepareCount >= 2);
      assert.equal(realtimePrepareCount, 2); assert.equal(ordinaryPrepareCount, beforeOrdinary);
      await clickSelector(window, '[data-testid="avatar-toggle"]');
      await openNewConversation(window);
      await waitForSelector(window, '.aui-thread-welcome-root');
      await clickSelector(window, '[data-testid="avatar-toggle"]');
      await waitUntil('new connection automatically starts microphone', () => realtimePrepareCount >= 3);
      const beforeNew = avatarChatRequests.length;
      realtimeText = '实时模式创建的新会话。';
      await waitUntil('first voice message persists a new thread', () => avatarChatRequests.length > beforeNew);
      avatarStatus = { ...avatarStatus, busy: false }; window.webContents.send('avatar:changed', avatarStatus);
      avatarStatus = { ...avatarStatus, error: '桌宠语音合成失败：语音供应商请求受限，请检查额度或稍后重试。（HTTP 429）' };
      window.webContents.send('avatar:changed', avatarStatus);
      await waitForText(window, '[data-testid="notification-toast"]', 'HTTP 429');
      await window.webContents.executeJavaScript('new Promise(resolve => setTimeout(resolve, 250))');
      const notificationLayout = await window.webContents.executeJavaScript(`(() => {
        const toast = [...document.querySelectorAll('[data-testid="notification-toast"]')].find(el => el.textContent.includes('HTTP 429'));
        const box = toast.getBoundingClientRect();
        const close = toast.querySelector('button[aria-label="关闭通知"]');
        const button = close.getBoundingClientRect();
        return { top: box.top, titlebarBottom: document.querySelector('.app-titlebar')?.getBoundingClientRect().bottom ?? 0,
          fits: box.right <= innerWidth && box.bottom <= innerHeight && toast.scrollWidth <= toast.clientWidth,
          closeReachable: close.contains(document.elementFromPoint(button.x + button.width / 2, button.y + button.height / 2)) };
      })()`);
      assert.ok(notificationLayout.top >= notificationLayout.titlebarBottom + 8, 'Notifications must clear the native titlebar control area');
      assert.ok(notificationLayout.fits && notificationLayout.closeReachable, 'Full error and its close button must remain reachable');
      writeFileSync(join(projectRoot, '.test-dist', 'speech-error-notification.png'), (await window.webContents.capturePage()).toPNG());
      await window.webContents.executeJavaScript(`const toast = [...document.querySelectorAll('[data-testid="notification-toast"]')].find(el => el.textContent.includes('HTTP 429')); toast.querySelector('button[aria-label="关闭通知"]').click()`);
      await clickSelector(window, '[data-testid="avatar-toggle"]');
      testingRealtime = false; includeGoogleSpeechFixture = false;
      await clickSelector(window, '[data-testid="settings-launcher"]');
      await waitForSelector(window, '[data-testid="general-settings"]');
    });

    await runStep("open model settings", async () => {
      await clickSelector(window, '[data-testid="settings-tab-models"]');
      await waitForSelector(window, '[data-testid="model-row"]');
      await waitForText(window, '[data-testid="settings-page"]', "DeepSeek Chat");
      assert.equal(
        await window.webContents.executeJavaScript(
          `document.querySelectorAll('[data-testid="provider-row"]').length`,
        ),
        1,
      );
    });
    await runStep("compact empty states and recovery navigation", async () => {
      await clickSelector(window, '[data-testid="settings-back"]');
      await waitForSelector(window, '[data-testid="settings-launcher"]');
      emptyConfigMode = true;
      appSettings = { ...appSettings, defaultLanguageModelConfigId: null, defaultSpeechModelConfigId: null };
      await new Promise((resolve) => { window.webContents.once("did-finish-load", resolve); window.reload(); });
      await waitForSelector(window, '[data-testid="settings-launcher"]');
      await clickSelector(window, '[data-testid="settings-launcher"]');
      await waitForSelector(window, '[data-testid="general-settings"]');
      await clickSelector(window, '[data-testid="theme-light"]');
      if (process.platform === "win32") {
        await waitUntil("native title bar follows light theme", () => String(window.getAccentColor()).toLowerCase() === "#ffffff");
      }
      await new Promise(resolve => setTimeout(resolve, 300));
      await waitForText(window, '[data-testid="default-language-model"]', '无');
      await clickSelector(window, '[data-testid="default-language-model"]');
      await waitForText(window, '[data-testid="provider-list"]', '尚未添加供应商');
      assert.equal(await window.webContents.executeJavaScript(`document.querySelectorAll('[data-testid="provider-list"] button').length`), 0);
      await waitForSelector(window, '[data-testid="add-provider"]');
      await clickSelector(window, '[data-testid="settings-back"]');
      await waitForSelector(window, '[data-testid="settings-launcher"]');
      await clickSelector(window, '[data-testid="character-launcher"]');
      await waitForSelector(window, '[data-testid="character-model"]');
      await waitForText(window, '[data-testid="character-model"]', '无');
      await new Promise(resolve => setTimeout(resolve, 300));
      await clickSelector(window, '[data-testid="character-model"]');
      await waitForSelector(window, '[data-testid="model-management"]');
      await clickSelector(window, '[data-testid="settings-back"]');
      await waitForSelector(window, '[data-testid="settings-launcher"]');
      console.log("[empty-states] navigation passed; checking recovery");
      failModelSettingsRead = true;
      await clickSelector(window, '[data-testid="settings-launcher"]');
      await waitForText(window, '[data-testid="general-settings"] [role="alert"]', '加载失败');
      console.log("[empty-states] error displayed");
      failModelSettingsRead = false;
      await clickSelector(window, '[data-testid="general-settings"] button');
      await waitUntil('settings retry recovered', async () => window.webContents.executeJavaScript(`document.querySelector('[data-testid="default-language-model"]')?.disabled === false && !document.querySelector('[data-testid="general-settings"] [role="alert"]')`));
      emptyConfigMode = false;
    });
    await runStep("provider save imports known models and leaves unknowns for manual classification", async () => {
      await clickSelector(window, '[data-testid="settings-tab-models"]');
      await waitForSelector(window, '[data-testid="add-provider"]');
      await window.webContents.executeJavaScript(`document.querySelector('[data-testid="add-provider"]').click()`);
      await waitForSelector(window, '#provider-secret');
      await window.webContents.executeJavaScript(`document.querySelector('#provider-secret').focus()`);
      await window.webContents.insertText('fixture-key');
      await waitUntil('provider credential entered', () => window.webContents.executeJavaScript(`document.querySelector('#provider-secret').value === 'fixture-key'`));
      await window.webContents.executeJavaScript(`document.querySelector('[role="dialog"] button[type="submit"]').click()`);
      await waitUntil('automatic model import', () => automaticDiscoveryRequests === 1);
      await waitForText(window, '[data-testid="model-row"]', 'DeepSeek V4 Pro');
      await waitUntil('provider dialog closed without classification prompts', () => window.webContents.executeJavaScript(`document.querySelector('[role="dialog"]') === null`));
      assert.equal(await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[data-testid="model-categories"] [role="tab"]')).some(el => el.textContent === '未分类')`), false);
      await waitForText(window, '[data-testid="discovered-model-row"]', 'Unknown Model');
      const languageTabId = await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[data-testid="model-categories"] [role="tab"]')).find(el => el.textContent === '语言').id`);
      await clickSelector(window, `[id=${JSON.stringify(languageTabId)}]`);
      await waitUntil('unknown model excluded from language category', () => window.webContents.executeJavaScript(`(() => {
        const tab = Array.from(document.querySelectorAll('[data-testid="model-categories"] [role="tab"]')).find(el => el.textContent === '语言');
        const panel = document.getElementById(tab.getAttribute('aria-controls'));
        return tab.getAttribute('aria-selected') === 'true' && panel !== null && !panel.textContent.includes('Unknown Model');
      })()`));
      const allTabId = await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[data-testid="model-categories"] [role="tab"]')).find(el => el.textContent === '全部').id`);
      await clickSelector(window, `[id=${JSON.stringify(allTabId)}]`);
      await waitForText(window, '[data-testid="discovered-model-row"]', 'Unknown Model');
      await window.webContents.executeJavaScript(`document.querySelector('[data-testid="quick-add-model"]').click()`);
      await waitForSelector(window, '#model-id');
      assert.equal(await window.webContents.executeJavaScript(`document.querySelector('#model-id').value`), 'custom-unknown');
      await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role="dialog"] [role="tab"]')).find(el => el.textContent === '语言').click()`);
      await clickSelector(window, '[role="dialog"] button[type="submit"]');
      await waitUntil('manual classification saved', () => createdModelRequest?.modelId === 'custom-unknown');
      assert.equal(createdModelRequest.modelType, 'languageModel');
      await waitUntil('model dialog closed', () => window.webContents.executeJavaScript(`document.querySelector('[role="dialog"]') === null`));
      await waitForText(window, '[data-testid="model-row"]', 'Unknown Model');
    });

    await runStep("choose a provider type from the searchable picker", async () => {
      await window.webContents.executeJavaScript(
        `document.querySelector('[data-testid="add-provider"]').click()`,
      );
      await waitForSelector(window, '[data-testid="provider-type-trigger"]');
      assert.equal(
        await window.webContents.executeJavaScript(
          `document.querySelector('[data-testid="provider-type-trigger"]').getAttribute('aria-expanded')`,
        ),
        "false",
      );

      await clickSelector(window, '[data-testid="provider-type-trigger"]');
      await waitForSelector(window, '[data-testid="provider-type-search"]');
      await window.webContents.executeJavaScript(`(() => {
        const input = document.querySelector('[data-testid="provider-type-search"]');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(
          input,
          'moonshot',
        );
        input.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);
      await waitForSelector(window, '[data-testid="provider-type-option-moonshotai"]');
      await clickSelector(window, '[data-testid="provider-type-option-moonshotai"]');
      await waitForText(window, '[data-testid="provider-type-trigger"]', "Moonshot AI");

      assert.deepEqual(
        await window.webContents.executeJavaScript(`({
          providerType: document.querySelector('[data-testid="provider-type-trigger"]').textContent,
          displayName: document.querySelector('#provider-name').value,
          baseUrlPlaceholder: document.querySelector('#provider-url').placeholder,
        })`),
        {
          providerType: "Moonshot AI",
          displayName: "Moonshot AI",
          baseUrlPlaceholder: "https://api.moonshot.ai/v1",
        },
      );
      assert.equal(
        await window.webContents.executeJavaScript(
          `document.querySelector('[data-testid="provider-type-trigger"]').getAttribute('aria-expanded')`,
        ),
        "false",
      );
      await clickSelector(window, '[data-slot="dialog-close"]');
    });
    await runStep("local file references and pasted images cross the isolated preload", async () => {
      const imageWindow = createTestWindow();
      const source = join(runDirectory, 'native-image.png');
      writeFileSync(source, readFileSync(join(projectRoot, 'resources', 'katarune-logo.png')));
      const service = createAssetService({ userDataPath, characterResourcesPath: join(userDataPath, 'unused') });
      try {
        await imageWindow.loadURL('about:blank');
        await imageWindow.webContents.executeJavaScript(`document.body.innerHTML = '<input type="file" id="native-image">'`);
        imageWindow.webContents.debugger.attach('1.3');
        const { root } = await imageWindow.webContents.debugger.sendCommand('DOM.getDocument');
        const { nodeId } = await imageWindow.webContents.debugger.sendCommand('DOM.querySelector', { nodeId: root.nodeId, selector: '#native-image' });
        await imageWindow.webContents.debugger.sendCommand('DOM.setFileInputFiles', { nodeId, files: [source] });
        const referenced = assetSchema.parse(await imageWindow.webContents.executeJavaScript(`window.katarune.importLocalChatAttachment(${JSON.stringify(characterId)}, document.querySelector('#native-image').files[0])`));
        assert.equal(memoryDatabase.fetchAssetSourcePath(referenced.id), source);
        assert.deepEqual(Buffer.from(service.readChatAttachment(referenced.id, memoryDatabase).data), readFileSync(source));
        assert.equal(JSON.stringify(referenced).includes(source), false);
        const pasted = assetSchema.parse(await imageWindow.webContents.executeJavaScript(`(async () => window.katarune.importLocalChatAttachment(${JSON.stringify(characterId)}, new File([await document.querySelector('#native-image').files[0].arrayBuffer()], 'paste.png', { type: 'image/png' })))()`));
        assert.equal(memoryDatabase.fetchAssetSourcePath(pasted.id), null);
        assert.deepEqual(readFileSync(service.resolveManagedPath(pasted.id)), readFileSync(source));
        const textSource = join(runDirectory, 'native-notes.txt');
        writeFileSync(textSource, 'attached notes');
        await imageWindow.webContents.debugger.sendCommand('DOM.setFileInputFiles', { nodeId, files: [textSource] });
        const textReference = assetSchema.parse(await imageWindow.webContents.executeJavaScript(`window.katarune.importLocalChatAttachment(${JSON.stringify(characterId)}, document.querySelector('#native-image').files[0])`));
        assert.equal(memoryDatabase.fetchAssetSourcePath(textReference.id), textSource);
        assert.equal(new TextDecoder().decode(service.readChatAttachment(textReference.id, memoryDatabase).data), 'attached notes');
        service.releaseChatAttachment(textReference.id, memoryDatabase);
        assert.equal(readFileSync(textSource, 'utf8'), 'attached notes');
        service.releaseChatAttachment(referenced.id, memoryDatabase);
        service.releaseChatAttachment(pasted.id, memoryDatabase);
        assert.ok(readFileSync(source).byteLength > 0);
      } finally { if (imageWindow.webContents.debugger.isAttached()) imageWindow.webContents.debugger.detach(); imageWindow.destroy(); }
    });
    await runStep("live history uses existing conversation UI without a composer or duplicate writes", async () => {
      await clickSelector(window, '[data-testid="settings-back"]');
      await waitForSelector(window, '[data-testid="thread-starline-item"]');
      const liveId = 'live-ui-thread';
      const owner = activeCharacterId;
      threads.unshift({ remoteId: liveId, characterId: owner, kind: 'live', status: 'regular', title: '后台直播记录', lastMessageAt: new Date() });
      const liveMessages = [
        { id: 'live-user', parent_id: null, format: 'ai-sdk/v6', content: { role: 'user', parts: [{ type: 'text', text: '本轮观众互动' }] } },
        { id: 'live-assistant', parent_id: 'live-user', format: 'ai-sdk/v6', content: { role: 'assistant', parts: [{ type: 'text', text: '后台保存的直播回复' }] } },
      ];
      storedMessages.set(messageKey(liveId, owner), liveMessages);
      avatarStatus = { ...avatarStatus, live: true, phase: 'ready', binding: { characterId: owner, threadId: liveId } };
      window.webContents.send('avatar:changed', avatarStatus);
      changeLiveFixture({ phase: 'running', threadId: liveId, runId: '11111111-1111-4111-8111-111111111111', settings: { ...DEFAULT_LIVE_SETTINGS, characterId: owner } });
      await waitForText(window, '.thread-starline-root', '后台直播记录');
      await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[data-testid="thread-starline-trigger"]')).find(element=>element.textContent.includes('后台直播记录')).click()`);
      await waitForText(window, '[data-slot="aui_thread-viewport"]', '后台保存的直播回复');
      assert.equal(await window.webContents.executeJavaScript(`!!document.querySelector('.aui-composer-root')`), false);
      liveMessages[1] = { ...liveMessages[1], content: { role: 'assistant', parts: [{ type: 'text', text: '持续更新的直播回复' }] } };
      changeLiveFixture({ generating: true });
      await waitForText(window, '[data-slot="aui_thread-viewport"]', '持续更新的直播回复');
      changeLiveFixture({ generating: false }); await new Promise(resolve=>setTimeout(resolve,300));
      assert.equal(appendedMessageRequests.filter(request=>request.threadId===liveId).length,0);
      assert.equal(titleRequests.filter(request=>request.threadId===liveId).length,0);
    });
  } catch (error) {
    if (!window.isDestroyed()) {
      const frame = await window.webContents.capturePage().catch(() => null);
      if (frame) writeFileSync(join(projectRoot, '.test-dist', 'ui-smoke-failure.png'), frame.toPNG());
    }
    throw error;
  } finally {
    await mcpService?.close();
    if (!window.isDestroyed()) window.destroy();
  }
}

console.log("[ui-smoke] waiting for Electron");
void app.whenReady()
  .then(run)
  .catch((error) => {
    exitCode = 1;
    console.error(error);
  })
  .finally(async () => {
    await mcpService?.close();
    memoryDatabase?.close();
    if (exitCode) app.exit(exitCode);
    else app.quit();
  });
