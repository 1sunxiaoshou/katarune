import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { app, BrowserWindow, ipcMain, protocol } from "electron";
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

const now = new Date("2026-07-19T00:00:00.000Z");
const providerId = "d3867f4b-e85f-4ff4-ac2b-974dc39ad832";
const modelId = "e76076e7-73a8-42c2-92d7-f9fa8d44f5eb";
const googleProviderId = "00000000-0000-4000-8000-000000000010";
const googleSpeechModelId = "00000000-0000-4000-8000-000000000011";
const manualSpeechModelId = "00000000-0000-4000-8000-000000000012";
const characterId = "00000000-0000-4000-8000-000000000001";
let emptyConfigMode = false;
let includeGoogleSpeechFixture = false;
let googleVoiceCatalogRefreshed = false;
let createdProviderRequest = null;
let createdProvider = null;
let replacedCredentialRequest = null;
let createdModelRequest = null;
let createdModel = null;
let updatedModelRequest = null;
let modelEnabled = true;
let appSettings = { defaultLanguageModelConfigId: null };
let updatedCharacterRequest = null;
let committedPortraitRequest = null;
let discardedPortraitStageRequest = null;
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
  name: "星澜",
  portraitAssetId: "00000000-0000-4000-8000-000000000002",
  portraitFocusX: 0.5,
  portraitFocusY: 0,
  portraitZoom: 1,
  modelConfigId: modelId,
  speechModelConfigId: null,
  speechVoice: null,
  systemPrompt: "你是星澜，一位温柔、沉静的数字角色。",
  createdAt: now,
  updatedAt: now,
};
const secondCharacter = {
  id: "00000000-0000-4000-8000-000000000003",
  name: "月影",
  portraitAssetId: null,
  portraitFocusX: 0.5,
  portraitFocusY: 0,
  portraitZoom: 1,
  modelConfigId: null,
  speechModelConfigId: null,
  speechVoice: null,
  systemPrompt: "你是月影。",
  createdAt: now,
  updatedAt: now,
};
let characters = [character, secondCharacter];
let activeCharacterId = characterId;
let threads = [
  ...Array.from({ length: 18 }, (_, index) => ({
    remoteId: `starline-thread-${index + 1}`,
    status: "regular",
    title: index === 0 ? "雨停后的第一封信" : `星轨会话 ${index + 1}`,
    lastMessageAt: new Date(now.getTime() - index * 3_600_000),
    characterId,
  })),
  {
    remoteId: "archived-starline-thread",
    status: "archived",
    title: "不应出现的归档会话",
    lastMessageAt: now,
    characterId,
  },
  {
    remoteId: "second-character-visible-thread",
    status: "regular",
    title: "只属于月影的会话",
    lastMessageAt: now,
    characterId: secondCharacter.id,
  },
];
const storedMessages = new Map();
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

function messageKey(threadId, characterId) {
  return `${characterId}:${threadId}`;
}

function registerMockHandlers() {
  ipcMain.handle("avatar:status", () => avatarStatus);
  ipcMain.handle("avatar:start", (_event, binding) => avatarStatus = { phase: "ready", binding, error: null });
  ipcMain.handle("avatar:stop", () => avatarStatus = { phase: "stopped", binding: null, error: null });
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
    appSettings = request;
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
    const title = `星光下的${request.messages[0]?.text.slice(0, 12) ?? "新对话"}`;
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
        const isSecondCharacter = request.characterId === secondCharacter.id;
        const isCrossCharacterRun = serializedMessages.includes("跨角色");
        const shouldRenderMemoryTool =
          serializedMessages.includes("测试记忆工具") &&
          !serializedMessages.includes("wiki_search");
        if (shouldRenderMemoryTool) {
          writer.write({ type: "start-step" });
          const toolCalls = [
            {
              id: "memory-search-call",
              name: "wiki_search",
              input: { query: "不应显示的搜索词" },
              output: {
                status: "ok",
                results: [
                  {
                    page: "profile.md",
                    line: 2,
                    excerpt: "不应显示的记忆正文",
                    revision: `sha256:${"a".repeat(64)}`,
                  },
                ],
                truncated: false,
              },
            },
            {
              id: "memory-get-call",
              name: "wiki_get",
              input: { page: "profile.md" },
              output: {
                status: "found",
                page: "profile.md",
                revision: `sha256:${"a".repeat(64)}`,
                totalLines: 2,
                startLine: 1,
                endLine: 2,
                content: "不应显示的读取正文",
              },
            },
            {
              id: "memory-patch-call",
              name: "wiki_apply_patch",
              input: {
                baseRevision: `sha256:${"a".repeat(64)}`,
                patch: "*** Begin Patch\\n*** Update File: profile.md\\n@@\\n-secret\\n+不应显示的补丁\\n*** End Patch",
              },
              output: {
                status: "applied",
                page: "profile.md",
                revision: `sha256:${"b".repeat(64)}`,
              },
            },
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
          writer.write({ type: "finish-step" });
          writer.write({ type: "start-step" });
        }
        writer.write({ type: "text-start", id: "mock-text" });
        writer.write({
          type: "text-delta",
          id: "mock-text",
          delta: isSecondCharacter ? "月光已经" : "星光已经",
        });
        writer.write({
          type: "text-delta",
          id: "mock-text",
          delta: `${isCrossCharacterRun ? "跨角色" : ""}抵达：${request.threadId}。`,
        });
        writer.write({ type: "text-end", id: "mock-text" });
        if (shouldRenderMemoryTool) writer.write({ type: "finish-step" });
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
  ipcMain.handle("model-configs:list", () => ({
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
  }));
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
  ipcMain.handle("model-configs:discover", () => ({
    models: [
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
  }));
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
      portraitFocusX: 0.5,
      portraitFocusY: 0,
      portraitZoom: 1,
      modelConfigId: request.modelConfigId,
      speechModelConfigId: request.speechModelConfigId,
      speechVoice: request.speechVoice,
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
  ipcMain.handle("characters:stage-portrait", () => ({
    canceled: true,
    stage: null,
  }));
  ipcMain.handle("characters:commit-portrait", (_event, request) => {
    committedPortraitRequest = request;
    const target =
      request.mode === "existing"
        ? characters.find((candidate) => candidate.id === request.id)
        : {
            id: "00000000-0000-4000-8000-000000000099",
            portraitAssetId: request.stageId,
            createdAt: now,
            ...request.character,
          };
    const updated = {
      ...target,
      portraitAssetId: request.stageId ?? target.portraitAssetId,
      portraitFocusX: request.framing.focusX,
      portraitFocusY: request.framing.focusY,
      portraitZoom: request.framing.zoom,
      updatedAt: now,
    };
    characters = characters.map((candidate) =>
      candidate.id === updated.id ? updated : candidate,
    );
    if (updated.id === characterId) character = updated;
    return updated;
  });
  ipcMain.handle("characters:discard-portrait-stage", (_event, request) => {
    discardedPortraitStageRequest = request;
    return { success: true };
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
  while (!predicate()) {
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

function createTestWindow() {
  return new BrowserWindow({
    width: 1280,
    height: 900,
    show: false,
    backgroundColor: "#ffffff",
    webPreferences: {
      preload: join(projectRoot, "out", "preload", "index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
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
          '请确认星光是否抵达',
        );
        input.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);
      await clickSelector(window, 'button[aria-label="Send message"]');
      await waitForText(
        window,
        '[data-slot="aui_thread-viewport"]',
        "抵达：",
      );
      await waitUntil("message persistence and thread metadata refresh", () => activeChatStreamCount === 0 && pendingThreadListLoads === 0 && completedThreadListLoads > listLoadsBeforeSend);
      const listRefresh = await window.webContents.executeJavaScript(`(() => {
        const probe = window.threadListProbe;
        probe.observer.disconnect();
        return { flashes: probe.flashes, originalRowRetained: probe.row.isConnected };
      })()`);
      assert.deepEqual(listRefresh, { flashes: 0, originalRowRetained: true });
    });

    await runStep("render private Memory Wiki tool status", async () => {
      await window.webContents.executeJavaScript(`(() => {
        const input = document.querySelector('.aui-composer-input');
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(
          input,
          '测试记忆工具',
        );
        input.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);
      await clickSelector(window, 'button[aria-label="Send message"]');
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
        "已更新记忆",
      );
      assert.equal(
        await window.webContents.executeJavaScript(`(() => {
          const text = document.querySelector('[data-slot="aui_thread-viewport"]')?.textContent ?? '';
          return [
            '不应显示的搜索词',
            '不应显示的记忆正文',
            '不应显示的读取正文',
            '不应显示的补丁',
          ].some((secret) => text.includes(secret));
        })()`),
        false,
      );
      await waitUntil(
        "Memory Wiki response stream completion",
        () => activeChatStreamCount === 0,
      );
      await waitForSelector(window, 'button[aria-label="Send message"]');
    });

    await runStep("import attachments from picker, drop, and clipboard", async () => {
      await waitForSelector(window, 'button[aria-label="Add Attachment"]');
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
      await clickSelector(window, 'button[aria-label="Add Attachment"]');
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
      await clickSelector(window, 'button[aria-label="Send message"]');
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
        else await clickSelector(window, 'button[aria-label="Send message"]');
      };
      await sendText("桌宠第一句");
      await waitForText(window, '[data-slot="aui_thread-viewport"]', "字幕对白第1句");
      await sendText("桌宠第二句");
      await waitForText(window, '[role="status"]', "1");
      await sendText("桌宠第三句", true);
      await waitForText(window, '[role="status"]', "2");
      assert.equal(avatarChatRequests.length, 1);
      assert.equal(canceledAvatarStreams, 0);
      assert.equal(await window.webContents.executeJavaScript(`document.querySelector('button[aria-label="Stop generating"]') === null`), true);
      releaseAvatarOutput();
      await waitForText(window, '[data-slot="aui_thread-viewport"]', "字幕对白第3句");
      await waitUntil("avatar stream completed", () => activeChatStreamCount === 0);
      assert.equal(avatarChatRequests.length, 3);
      await waitUntil("avatar thread gets a native title after its first reply", () => titleRequests.some(r => r.threadId === avatarChatRequests[0].threadId));
      assert.equal(titleRequests.filter(r => r.threadId === avatarChatRequests[0].threadId).length, 1);
      await waitForText(window, "body", "星光下的桌宠第一句");
      assert.equal(canceledAvatarStreams, 0);
      assert.equal(avatarChatRequests[1].messages.at(-1).parts[0].text, "桌宠第二句");
      assert.equal(avatarChatRequests[2].messages.at(-1).parts[0].text, "桌宠第三句");
      const rendered = await window.webContents.executeJavaScript(`document.querySelector('[data-slot="aui_thread-viewport"]').textContent`);
      assert.equal(rendered.split("字幕对白第1句").length - 1, 1);
      await waitUntil("native text history persisted", () => JSON.stringify([...storedMessages.values()]).includes("字幕对白第3句"));
      await clickSelector(window, '[data-testid="avatar-toggle"]');
      await waitForText(window, '[data-testid="avatar-toggle"]', "连接桌宠");
      await clickSelector(window, 'button[aria-label="新对话"]');
      await waitForSelector(window, ".aui-thread-welcome-root");
      await sendText("普通新会话标题");
      await waitUntil("ordinary thread title generated", () => titleRequests.some(r => r.messages[0]?.text === "普通新会话标题"));
      await waitForText(window, "body", "星光下的普通新会话标题");
      await waitUntil("ordinary chat completed", () => activeChatStreamCount === 0);
      assert.equal(titleRequests.filter(r => r.messages[0]?.text === "普通新会话标题").length, 1);
    });

    await runStep("bind character speech model", async () => {
      includeGoogleSpeechFixture = true;
      await clickSelector(window, '[data-testid="character-launcher"]');
      await waitForSelector(window, '[data-testid="character-page"]');
      await waitForText(window, '[data-testid="character-page"]', "星澜");
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
          updatedCharacterRequest?.speechVoice === "Kore",
      );
      await waitForText(window, '[data-testid="character-speech-voice"]', "Kore");
      includeGoogleSpeechFixture = false;
      await clickSelector(window, '[data-testid="character-back"]');
      await waitForSelector(window, '[data-slot="aui_thread-viewport"]');
    });

    await runStep("use general settings", async () => {
      await clickSelector(window, '[data-testid="settings-launcher"]');
      await waitForSelector(window, '[data-testid="settings-page"]');
      await waitForSelector(window, '[data-testid="general-settings"]');
      assert.equal(
        await window.webContents.executeJavaScript(
          `document.querySelector('[data-testid="general-settings"] [data-slot="card"]')`,
        ),
        null,
      );
      await clickSelector(window, '[data-testid="theme-dark"]');
      await waitForSelector(window, "html.dark");
      assert.equal(
        await window.webContents.executeJavaScript(
          `getComputedStyle(document.querySelector('[data-testid="theme-dark"]')).borderColor`,
        ),
        "rgba(0, 0, 0, 0)",
      );
      await clickSelector(window, '[data-testid="reduce-motion"]');
      await waitForSelector(window, 'html[data-reduce-motion]');
      await clickSelector(window, '[data-testid="auto-read-replies"]');
      assert.deepEqual(
        await window.webContents.executeJavaScript(`({
          autoReadReplies: localStorage.getItem('katarune.autoReadReplies'),
          reduceMotion: localStorage.getItem('katarune.reduceMotion'),
        })`),
        { autoReadReplies: "true", reduceMotion: "true" },
      );
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

    await runStep("open model settings", async () => {
      await clickSelector(window, '[data-testid="settings-tab-models"]');
      await waitForSelector(window, '[data-testid="model-row"]');
      await waitForText(window, '[data-testid="settings-page"]', "DeepSeek Chat");
      assert.equal(
        await window.webContents.executeJavaScript(
          `getComputedStyle(document.querySelector('[data-testid="model-categories"] [data-active]')).borderColor`,
        ),
        "rgba(0, 0, 0, 0)",
      );
      assert.equal(
        await window.webContents.executeJavaScript(
          `document.querySelectorAll('[data-testid="provider-row"]').length`,
        ),
        1,
      );
      assert.deepEqual(
        await window.webContents.executeJavaScript(`(() => {
          const scrollStyle = (element) => {
            if (element === null) throw new Error('Missing settings scroll container');
            const style = getComputedStyle(element);
            return {
              overflowY: style.overflowY,
              scrollbarWidth: style.scrollbarWidth,
            };
          };
          const modelList = [...document.querySelectorAll('[data-testid="model-list-scroll"]')]
            .find((element) => getComputedStyle(element).display !== 'none');
          return {
            settings: scrollStyle(document.querySelector('[data-testid="settings-content"]')),
            providers: scrollStyle(document.querySelector('[data-testid="provider-list-scroll"]')),
            models: scrollStyle(modelList ?? null),
          };
        })()`),
        {
          settings: { overflowY: "auto", scrollbarWidth: "none" },
          providers: { overflowY: "auto", scrollbarWidth: "none" },
          models: { overflowY: "auto", scrollbarWidth: "none" },
        },
      );
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
    app.exit(exitCode);
  });
