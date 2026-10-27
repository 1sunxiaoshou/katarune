import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { app, BrowserWindow, ipcMain, protocol } from "electron";
import { openDatabase } from "../src/main/database/database";
import { createDiaryService } from "../src/main/memory/diaryService";
import { registerMemoryHandlers } from "../src/main/ipc/memoryHandlers";
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
let activeChatStreamCount = 0;
let maximumConcurrentChatStreams = 0;
let maximumConcurrentChatCharacters = 0;
const activeChatStreamsByCharacter = new Map();
let releaseFirstChatStream;
let releaseCrossCharacterStream;
let avatarStatus = { phase: "stopped", binding: null, error: null };
const avatarChatRequests = [];
const titleRequests = [];
let releaseAvatarOutput;
let canceledAvatarStreams = 0;
let pendingThreadListLoads = 0;
let completedThreadListLoads = 0;
let memoryDatabase;

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

function registerMockHandlers() {
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
  ipcMain.handle("avatar:user-subtitle", () => {});
  ipcMain.handle("app:get-info", () => ({
    name: "Katarune",
    version: "0.1.0",
    platform: "win32",
    electronVersion: process.versions.electron,
    nodeVersion: process.versions.node,
  }));
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
  ipcMain.handle("threads:initialize", (_event, request) => {
    if (!threads.some((thread) => thread.remoteId === request.threadId)) {
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
        if (serializedMessages.includes("测试工具终态")) {
          toolOnlyRequests += 1;
          if (request.messages.at(-1)?.role === "user" && JSON.stringify(request.messages.at(-1)).includes("测试工具终态")) {
            writer.write({ type: "start-step" });
            writer.write({ type: "tool-input-available", toolCallId: "terminal-memory", toolName: "memory_search", input: { query: "终态测试" } });
            writer.write({ type: "tool-output-available", toolCallId: "terminal-memory", output: { status: "ok", results: [] } });
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
          writer.write({ type: "tool-input-available", toolCallId: "performance-ui-ack", toolName: "avatar_perform", input: { steps: [{ at: "start", action: "system:greet", expression: "happy" }] } });
          writer.write({ type: "tool-output-available", toolCallId: "performance-ui-ack", output: { status: "accepted", performanceId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" } });
          writer.write({ type: "tool-input-available", toolCallId: "performance-ui-state-only", toolName: "avatar_perform", input: { steps: [{ at: "start", expression: "happy" }] } });
          writer.write({ type: "tool-output-available", toolCallId: "performance-ui-state-only", output: {} });
          writer.write({ type: "tool-input-available", toolCallId: "dance-ui", toolName: "avatar_play", input: { action: "action:test-dance" } });
          writer.write({ type: "tool-output-available", toolCallId: "dance-ui", output: { status: "started", performanceId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", action: "测试舞蹈" } });
          writer.write({ type: "tool-input-available", toolCallId: "dance-ui-error", toolName: "avatar_play", input: { action: "action:test-dance" } });
          writer.write({ type: "tool-output-error", toolCallId: "dance-ui-error", errorText: "舞蹈伴奏无法加载。" });
          writer.write({ type: "finish-step" }); writer.write({ type: "start-step" });
        }
        const shouldRenderMemoryTool =
          serializedMessages.includes("测试记忆工具") &&
          !serializedMessages.includes("memory_search");
        if (shouldRenderMemoryTool) {
          writer.write({ type: "start-step" });
          const toolCalls = [
            {
              id: "memory-search-call",
              name: "memory_search",
              input: { query: "不应显示的搜索词", kind: null },
              output: {
                status: "ok",
                results: [
                  {
                    id: "00000000-0000-4000-8000-000000000011", kind: "person", title: "示例人物", isUser: true,
                    body: "不应显示的记忆正文", revision: 1, bodyTruncated: false,
                  },
                ],
                truncated: false,
              },
            },
            {
              id: "memory-get-call",
              name: "memory_read",
              input: { id: "00000000-0000-4000-8000-000000000011" },
              output: {
                status: "found",
                entry: { id: "00000000-0000-4000-8000-000000000011", kind: "person", title: "示例人物", isUser: true,
                  body: "不应显示的读取正文", revision: 1, bodyTruncated: false },
              },
            },
            {
              id: "memory-save-call",
              name: "memory_save",
              input: {
                id: "00000000-0000-4000-8000-000000000011", revision: 1,
                kind: "person", title: "示例人物", body: "不应显示的保存正文", isUser: true,
              },
              output: {
                status: "saved",
                id: "00000000-0000-4000-8000-000000000011", revision: 2,
              },
            },
            { id: "memory-forget-call", name: "memory_forget",
              input: { id: "00000000-0000-4000-8000-000000000011", revision: 2 },
              output: { status: "forgotten", id: "00000000-0000-4000-8000-000000000011", revision: 3 } },
            { id: "memory-conflict-call", name: "memory_save",
              input: { id: "00000000-0000-4000-8000-000000000011", revision: 1, kind: "person", title: "示例人物", body: "过时正文", isUser: true },
              output: { status: "conflict", message: "请重新读取。" } },
            { id: "memory-duplicate-call", name: "memory_save",
              input: { id: null, revision: null, kind: "person", title: "示例人物", body: "重复正文", isUser: true },
              output: { status: "duplicate", existing: { id: "00000000-0000-4000-8000-000000000011", title: "示例人物" }, message: "请先读取。" } },
          ];
          for (const toolCall of toolCalls) {
            writer.write({
              type: "tool-input-start",
              toolCallId: toolCall.id,
              toolName: toolCall.name,
            });
            writer.write({
              type: "tool-input-delta",
              toolCallId: toolCall.id,
              inputTextDelta: JSON.stringify(toolCall.input),
            });
            writer.write({
              type: "tool-input-available",
              toolCallId: toolCall.id,
              toolName: toolCall.name,
              input: toolCall.input,
            });
            writer.write({
              type: "tool-output-available",
              toolCallId: toolCall.id,
              output: toolCall.output,
            });
          }
          writer.write({ type: "tool-input-error", toolCallId: "memory-invalid-input", toolName: "memory_search", input: { query: 42 }, errorText: "Invalid input for tool memory_search: query: expected string" });
          writer.write({ type: "tool-output-error", toolCallId: "memory-invalid-input", errorText: "Invalid input for tool memory_search: query: expected string" });
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
  const builtin = { id: "builtin:default", builtin: true,
    manifest: { formatVersion: 3, name: "春原心奈", version: "1.0.0", portrait: "portrait.png", thumbnail: "thumbnail.png", model: "avatar.vrm", actions: [] },
    portraitAssetId: "00000000-0000-4000-8000-000000000002", thumbnailAssetId: "00000000-0000-4000-8000-000000000004", actions: [], referenceCount: characters.length };
  let packages = [builtin, { ...builtin,
    id: "00000000-0000-4000-8000-000000000031", builtin: false,
    manifest: { ...builtin.manifest, name: "测试角色包", author: "测试作者" }, referenceCount: 0 }];
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

async function clickSelector(window, selector) {
  const point = await window.webContents.executeJavaScript(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (element === null) {
      throw new Error('Missing element: ' + ${JSON.stringify(selector)});
    }
    const rect = element.getBoundingClientRect();
    return {
      x: Math.round(rect.left + rect.width / 2),
      y: Math.round(rect.top + rect.height / 2),
    };
  })()`);
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
}

function createTestWindow(size = { width: 1280, height: 900 }) {
  return new BrowserWindow({
    ...size,
    show: false,
    backgroundColor: "#ffffff",
    webPreferences: {
      preload: join(projectRoot, "out", "preload", "index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      offscreen: true,
    },
  });
}

async function runStep(label, action) {
  const startedAt = performance.now();
  console.log(`[ui-smoke] ${label}: start`);
  await action();
  console.log(`[ui-smoke] ${label}: pass (${Math.round(performance.now() - startedAt)} ms)`);
}

let exitCode = 0;

async function run() {
  registerMockHandlers();
  const window = createTestWindow();

  try {
    await runStep("boot renderer", async () => {
      await window.loadFile(join(projectRoot, "out", "renderer", "index.html"));
      await waitForSelector(window, '[data-slot="aui_thread-viewport"]');
      await window.webContents.insertCSS(`
        *, *::before, *::after {
          animation-delay: 0s !important;
          animation-duration: 0s !important;
          transition-delay: 0s !important;
          transition-duration: 0s !important;
        }
      `);
      await waitForSelector(window, '[data-testid="thread-starline-item"]');
    });

    await runStep("browse, edit and forget real SQLite memories", async () => {
      const key = async (keyCode, modifiers = []) => {
        window.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
        window.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
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
      await clickSelector(window, '[data-testid="memory-add"]');
      await waitForSelector(window, '[data-testid="memory-editor"]');
      assert.equal(await window.webContents.executeJavaScript(`document.querySelector('[role="dialog"]') === null && document.querySelector('.memory-reading > [data-testid="memory-editor"]') !== null`), true, 'editing must remain in the original reading area');
      await fill('[data-testid="memory-title-input"]', '小林');
      await fill('[data-testid="memory-body-input"]', '用户的朋友，喜欢读书。', true);
      await clickSelector(window, '.memory-user-label [role="switch"]');
      assert.equal(await window.webContents.executeJavaScript(`document.querySelector('.memory-user-label [role="switch"]').getAttribute('aria-checked')`), 'true');
      await clickSelector(window, '[data-testid="memory-save"]');
      await waitForText(window, '[data-testid="memory-detail"]', '用户的朋友');
      assert.equal(memoryDatabase.listMemory({ characterId, kind: 'person', query: '', offset: 0 }).entries[0].isUser, true, 'the shared person switch must persist the user flag');
      assert.equal(await window.webContents.executeJavaScript(`document.querySelector('#memory-is-user') === null`), true, 'reading a profile must not show the editing switch');
      await waitForText(window, '[data-testid="memory-list-item"][aria-current="true"] [aria-label="你的画像"]', '你');
      await clickSelector(window, '[data-testid="memory-tab-event"]');
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
      await waitForText(window, '[data-testid="memory-editor"] [role="alert"]', '这条记忆已被更新');
      assert.equal(memoryDatabase.readMemory(characterId, currentProfile.id).content.body, '后台更新的画像。');
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
        await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[data-testid="memory-list-item"]')).find(button => button.textContent.includes(${JSON.stringify(title)})).click()`);
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
        await compactDiary.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[data-testid="memory-list-item"]')).find(button => button.textContent.includes('很长的一天')).click()`);
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

    await runStep("render private memory tool status", async () => {
      await window.webContents.executeJavaScript(`(() => {
        const input = document.querySelector('.aui-composer-input');
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(
          input,
          '测试记忆工具',
        );
        input.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);
      await clickSelector(window, 'button[aria-label="发送消息"]');
      await waitForText(
        window,
        '[data-slot="aui_thread-viewport"]',
        "已搜索记忆",
      );
      await waitForText(
        window,
        '[data-slot="aui_thread-viewport"]',
        "已读取记忆",
      );
      await waitForText(
        window,
        '[data-slot="aui_thread-viewport"]',
        "已保存记忆",
      );
      await waitForText(window, '[data-slot="aui_thread-viewport"]', '已遗忘记忆');
      await waitForText(window, '[data-slot="aui_thread-viewport"]', '记忆已变化，正在等待重新读取');
      await waitForText(window, '[data-slot="aui_thread-viewport"]', '已有相关记忆，正在等待整理原条目');
      await waitForText(window, '[data-testid="memory-tool-status"] [role="alert"]', 'query: expected string');
      assert.equal(await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[data-testid="memory-tool-status"]')).some(item => item.textContent.includes('记忆搜索失败') && item.textContent.includes('query: expected string'))`), true);
      assert.equal(
        await window.webContents.executeJavaScript(`(() => {
          const text = document.querySelector('[data-slot="aui_thread-viewport"]')?.textContent ?? '';
          return [
            '不应显示的搜索词',
            '不应显示的记忆正文',
            '不应显示的读取正文',
            '不应显示的保存正文',
          ].some((secret) => text.includes(secret));
        })()`),
        false,
      );
      await waitUntil(
        "memory response stream completion",
        () => activeChatStreamCount === 0,
      );
      await waitForSelector(window, 'button[aria-label="发送消息"]');
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

    await runStep("render performance summary and authoritative playback state", async () => {
      await window.webContents.executeJavaScript(`(() => {
        const input = document.querySelector('.aui-composer-input');
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, '测试表演编排');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);
      await clickSelector(window, 'button[aria-label="发送消息"]');
      await waitForText(window, '[data-testid="avatar-performance"]', '已安排');
      await waitForText(window, '[data-tool-call-id="performance-ui-error"] [role="alert"]', '角色编排队列已满');
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
      window.webContents.send('avatar:changed', avatarStatus);
      await waitForText(window, '[data-tool-call-id="dance-ui"]', '舞蹈已启动');
      await waitForText(window, '[data-tool-call-id="dance-ui"]', '测试舞蹈');
      await waitForText(window, '[data-tool-call-id="dance-ui-error"] [role="alert"]', '舞蹈伴奏无法加载');
      const dance = { performanceId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', toolCallId: 'dance-ui', actionId: '11111111-1111-4111-8111-111111111111', action: '测试舞蹈', state: 'started' };
      window.webContents.send('avatar:changed', { ...avatarStatus, dance });
      await waitForText(window, '[data-tool-call-id="dance-ui"]', '正在表演');
      window.webContents.send('avatar:changed', { ...avatarStatus, dance: { ...dance, state: 'completed' } });
      await waitForText(window, '[data-tool-call-id="dance-ui"]', '舞蹈已完成');
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
    });

    await runStep("queue avatar dialogue without interrupting or restarting the Agent", async () => {
      await waitUntil("previous chat complete", () => activeChatStreamCount === 0);
      await clickSelector(window, 'button[aria-label="新对话"]');
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
      await sendText("桌宠第二句");
      await waitForText(window, '[role="status"]:not(.sr-only)', "1");
      await sendText("桌宠第三句", true);
      await waitForText(window, '[role="status"]:not(.sr-only)', "2");
      assert.equal(avatarChatRequests.length, 1);
      assert.equal(canceledAvatarStreams, 0);
      assert.equal(await window.webContents.executeJavaScript(`document.querySelector('button[aria-label="停止回复"]') === null`), true);
      releaseAvatarOutput();
      await waitForText(window, '[data-slot="aui_thread-viewport"]', "字幕对白第3句");
      await waitUntil("avatar stream completed", () => activeChatStreamCount === 0);
      assert.equal(avatarChatRequests.length, 3);
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
      await clickSelector(window, 'button[aria-label="新对话"]');
      await waitForSelector(window, ".aui-thread-welcome-root");
      await sendText("普通新会话标题");
      await waitUntil("ordinary thread title generated", () => titleRequests.some(r => r.messages[0]?.text === "普通新会话标题"));
      await waitForText(window, "body", "测试会话：普通新会话标题");
      await waitUntil("ordinary chat completed", () => activeChatStreamCount === 0);
      assert.equal(titleRequests.filter(r => r.messages[0]?.text === "普通新会话标题").length, 1);
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
      await clickSelector(window, 'button[aria-label="新对话"]');
      await waitForSelector(window, '.aui-thread-welcome-root');
      await clickSelector(window, '[data-testid="avatar-toggle"]');
      await waitUntil('new connection automatically starts microphone', () => realtimePrepareCount >= 3);
      const beforeNew = avatarChatRequests.length;
      realtimeText = '实时模式创建的新会话。';
      await waitUntil('first voice message persists a new thread', () => avatarChatRequests.length > beforeNew);
      avatarStatus = { ...avatarStatus, busy: false }; window.webContents.send('avatar:changed', avatarStatus);
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
  } finally {
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
  .finally(() => {
    memoryDatabase?.close();
    app.exit(exitCode);
  });
