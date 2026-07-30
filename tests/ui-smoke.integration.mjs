import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { app, BrowserWindow, ipcMain } from "electron";
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
} from "ai";

const projectRoot = process.cwd();
const userDataPath = join(projectRoot, ".test-dist", "ui-user-data");
const screenshotDirectory = mkdtempSync(join(tmpdir(), "katarune-ui-screenshots-"));

mkdirSync(userDataPath, { recursive: true });
app.setPath("userData", userDataPath);
app.commandLine.appendSwitch("disable-gpu");

const now = new Date("2026-07-19T00:00:00.000Z");
const providerId = "d3867f4b-e85f-4ff4-ac2b-974dc39ad832";
const modelId = "e76076e7-73a8-42c2-92d7-f9fa8d44f5eb";
const characterId = "00000000-0000-4000-8000-000000000001";
let emptyConfigMode = false;
let createdProviderRequest = null;
let createdProvider = null;
let replacedCredentialRequest = null;
let createdModelRequest = null;
let createdModel = null;
let updatedModelRequest = null;
let modelEnabled = true;
let updatedCharacterRequest = null;
let createdCharacterCount = 0;
let createdCharacterRequest = null;
let deletedCharacterRequest = null;
let renamedThreadRequest = null;
let generatedThreadTitleRequest = null;
let statusThreadRequest = null;
let deletedThreadRequest = null;
let character = {
  id: characterId,
  name: "星澜",
  portraitAssetId: "00000000-0000-4000-8000-000000000002",
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

function messageKey(threadId, characterId) {
  return `${characterId}:${threadId}`;
}

function registerMockHandlers() {
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
  ipcMain.handle("app-state:set-active-character", (_event, request) => {
    activeCharacterId = request.characterId;
    return {
      activeCharacter: characters.find((candidate) => candidate.id === activeCharacterId),
    };
  });
  ipcMain.handle("threads:list", (_event, request) => ({
    threads: threads.filter((thread) => thread.characterId === request.characterId),
  }));
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
        const serializedMessages = JSON.stringify(request.messages);
        const isSecondCharacter = request.characterId === secondCharacter.id;
        const isCrossCharacterRun = serializedMessages.includes("跨角色");
        writer.write({ type: "text-start", id: "mock-text" });
        writer.write({
          type: "text-delta",
          id: "mock-text",
          delta: isSecondCharacter ? "月光已经" : "星光已经",
        });
        if (
          request.characterId === characterId &&
          serializedMessages.includes("请保持跨角色后台生成")
        ) {
          await new Promise((resolve) => {
            releaseCrossCharacterStream = resolve;
          });
        } else if (request.threadId === "starline-thread-1") {
          await new Promise((resolve) => {
            releaseFirstChatStream = resolve;
          });
        } else if (request.threadId === "starline-thread-2") {
          releaseFirstChatStream?.();
          releaseFirstChatStream = undefined;
        }
        if (isSecondCharacter) {
          releaseCrossCharacterStream?.();
          releaseCrossCharacterStream = undefined;
        }
        writer.write({
          type: "text-delta",
          id: "mock-text",
          delta: `${isCrossCharacterRun ? "跨角色" : ""}抵达：${request.threadId}。`,
        });
        writer.write({ type: "text-end", id: "mock-text" });
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
        settings: null,
        enabled: modelEnabled,
        createdAt: now,
        updatedAt: now,
      },
      ...(createdModel === null ? [] : [createdModel]),
    ],
  }));
  ipcMain.handle("speech:list-available-models", () => ({
    modelConfigIds: [],
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
      createdAt: now,
      updatedAt: now,
    };
  });
  ipcMain.handle("model-configs:create", (_event, request) => {
    createdModelRequest = request;
    createdModel = {
      id: "3cab15e0-e330-4f78-80b9-8ebc99c919bd",
      ...request,
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
  ipcMain.handle("characters:import-portrait", () => ({
    canceled: true,
    character: null,
  }));
}

async function waitForSelector(window, selector) {
  const timeoutMessage = `Timed out waiting for ${selector}`;
  await window.webContents.executeJavaScript(`
    new Promise((resolve, reject) => {
      const deadline = Date.now() + 5000;
      const check = () => {
        if (document.querySelector(${JSON.stringify(selector)}) !== null) return resolve(true);
        if (Date.now() > deadline) return reject(new Error(${JSON.stringify(timeoutMessage)}));
        setTimeout(check, 25);
      };
      check();
    })
  `);
}

async function waitForToastMessage(window, message) {
  const timeoutMessage = `Timed out waiting for toast: ${message}`;
  await window.webContents.executeJavaScript(`
    new Promise((resolve, reject) => {
      const deadline = Date.now() + 5000;
      const check = () => {
        const matched = Array.from(
          document.querySelectorAll('[data-testid="notification-toast"]'),
          (element) => element.textContent,
        ).some((text) => text.includes(${JSON.stringify(message)}));
        if (matched) return resolve(true);
        if (Date.now() > deadline) return reject(new Error(${JSON.stringify(timeoutMessage)}));
        setTimeout(check, 25);
      };
      check();
    })
  `);
}

async function hoverSelector(window, selector) {
  const point = await window.webContents.executeJavaScript(`(() => {
    const rect = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
    return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
  })()`);
  window.webContents.sendInputEvent({ type: "mouseMove", ...point });
  await window.webContents.executeJavaScript(`new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
}

async function clickSelector(window, selector) {
  const point = await window.webContents.executeJavaScript(`(() => {
    const rect = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
    return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
  })()`);
  window.webContents.sendInputEvent({ type: "mouseMove", ...point });
  window.webContents.sendInputEvent({ type: "mouseDown", button: "left", clickCount: 1, ...point });
  window.webContents.sendInputEvent({ type: "mouseUp", button: "left", clickCount: 1, ...point });
  await window.webContents.executeJavaScript(`new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
}

async function switchCharacterFromChat(window, characterId) {
  await clickSelector(window, '[data-testid="character-launcher"]');
  await waitForSelector(window, '[data-testid="character-page"]');
  await clickSelector(
    window,
    `[data-character-id="${characterId}"] [data-testid="character-list-item"]`,
  );
  await clickSelector(window, '[data-testid="character-back"]');
  await waitForSelector(window, '[data-slot="aui_thread-viewport"]');
}

async function rightClickSelector(
  window,
  selector,
  menuSelector = '[data-testid="thread-context-menu"]',
) {
  const point = await window.webContents.executeJavaScript(`(() => {
    const rect = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
    return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
  })()`);
  window.webContents.sendInputEvent({ type: "mouseMove", ...point });
  window.webContents.sendInputEvent({ type: "mouseDown", button: "right", clickCount: 1, ...point });
  window.webContents.sendInputEvent({ type: "mouseUp", button: "right", clickCount: 1, ...point });
  await window.webContents.executeJavaScript(`new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(resolve))
  )`);
  await window.webContents.executeJavaScript(`(() => {
    if (document.querySelector(${JSON.stringify(menuSelector)}) !== null) return;
    document.querySelector(${JSON.stringify(selector)}).dispatchEvent(
      new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: ${point.x},
        clientY: ${point.y},
      }),
    );
  })()`);
  await waitForSelector(window, menuSelector);
}

async function capture(window, fileName) {
  await window.webContents.executeJavaScript(`
    document.fonts.ready.then(() => new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 400)));
    }))
  `);
  await window.webContents.capturePage();
  await new Promise((resolve) => setTimeout(resolve, 150));
  const image = await window.webContents.capturePage();
  const path = join(screenshotDirectory, fileName);
  await writeFile(path, image.toPNG());
  return path;
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

let exitCode = 0;

async function run() {
  console.log("UI smoke: registering IPC mocks");
  registerMockHandlers();

  const window = createTestWindow();

  window.webContents.on("console-message", (details) => {
    console.error(`Renderer console [${details.level}]: ${details.message}`);
  });
  window.webContents.on("render-process-gone", (_event, details) => {
    console.error(`Renderer process gone: ${details.reason} (${details.exitCode})`);
  });

  console.log("UI smoke: loading renderer");
  await window.loadFile(join(projectRoot, "out", "renderer", "index.html"));
  await waitForSelector(window, '[data-slot="aui_thread-viewport"]');
  const chatScrollMetrics = await window.webContents.executeJavaScript(`(() => {
    const viewport = document.querySelector('[data-slot="aui_thread-viewport"]');
    return {
      bodyOverflow: getComputedStyle(document.body).overflow,
      documentScrollHeight: document.documentElement.scrollHeight,
      windowHeight: window.innerHeight,
      viewportOverflowY: getComputedStyle(viewport).overflowY,
    };
  })()`);
  assert.equal(chatScrollMetrics.bodyOverflow, "hidden");
  assert.equal(chatScrollMetrics.documentScrollHeight, chatScrollMetrics.windowHeight);
  assert.equal(chatScrollMetrics.viewportOverflowY, "auto");
  await waitForSelector(window, '[data-testid="settings-launcher"]');
  await waitForSelector(window, '[data-testid="character-launcher"]');
  const launcherMetrics = await window.webContents.executeJavaScript(`(() => {
    const launcherElement = document.querySelector('[data-testid="settings-launcher"]');
    const launcher = launcherElement.getBoundingClientRect();
    const character = document.querySelector('[data-testid="character-launcher"]').getBoundingClientRect();
    return {
      left: Math.round(launcher.left),
      bottom: Math.round(window.innerHeight - launcher.bottom),
      width: Math.round(launcher.width),
      height: Math.round(launcher.height),
      isRound: Number.parseFloat(getComputedStyle(launcherElement).borderRadius) * 2 >= Math.min(launcher.width, launcher.height),
      characterLeft: Math.round(character.left),
      characterTop: Math.round(character.top),
      characterHeight: Math.round(character.height),
    };
  })()`);
  assert.deepEqual(launcherMetrics, {
    left: 24,
    bottom: 19,
    width: 32,
    height: 32,
    isRound: true,
    characterLeft: 24,
    characterTop: 24,
    characterHeight: 86,
  });

  await waitForSelector(window, '[data-testid="thread-starline-item"]');
  const initialStarline = await window.webContents.executeJavaScript(`(() => {
    const region = document.querySelector('[data-testid="thread-list-region"]');
    const scroll = document.querySelector('[data-testid="thread-starline-scroll"]');
    return {
      regularCount: document.querySelectorAll('[data-testid="thread-starline-item"]').length,
      includesArchived: region.textContent.includes('不应出现的归档会话'),
      hasNewThread: document.querySelector('[data-testid="thread-new"]') !== null,
      scrollable: scroll.scrollHeight > scroll.clientHeight,
      bottomFade: document.querySelector('[data-testid="thread-fade-bottom"]').getAttribute('data-visible'),
      settingLeftOfToggle:
        document.querySelector('[data-testid="settings-launcher"]').getBoundingClientRect().right <=
        document.querySelector('[data-testid="thread-list-visibility-toggle"]').getBoundingClientRect().left,
    };
  })()`);
  assert.equal(initialStarline.regularCount, 18);
  assert.equal(initialStarline.includesArchived, false);
  assert.equal(initialStarline.hasNewThread, true);
  assert.equal(initialStarline.scrollable, true);
  assert.equal(initialStarline.bottomFade, "true");
  assert.equal(initialStarline.settingLeftOfToggle, true);

  const typographyRoles = await window.webContents.executeJavaScript(`(() => {
    const fontFamily = (selector) => {
      const element = document.querySelector(selector);
      return element === null ? null : getComputedStyle(element).fontFamily;
    };
    return {
      characterName: fontFamily('[data-testid="character-launcher"] strong'),
      threadTitle: fontFamily('[data-testid="thread-starline-item"] .thread-starline-title'),
      welcomeTitle: fontFamily('.aui-thread-welcome-message-inner'),
      newThreadAction: fontFamily('[data-testid="thread-new"]'),
    };
  })()`);
  assert.match(typographyRoles.characterName, /Noto Serif SC Variable/);
  assert.match(typographyRoles.threadTitle, /Noto Serif SC Variable/);
  assert.match(typographyRoles.welcomeTitle, /Noto Serif SC Variable/);
  assert.doesNotMatch(typographyRoles.newThreadAction, /Noto Serif SC Variable/);

  await clickSelector(window, '[data-testid="thread-starline-item"]:nth-child(1) [data-testid="thread-starline-trigger"]');
  const activeMarker = await window.webContents.executeJavaScript(`document.querySelector('[data-testid="thread-starline-item"]:nth-child(1) [data-active], [data-testid="thread-starline-item"]:nth-child(1)[data-active]')?.textContent ?? document.querySelector('[data-testid="thread-starline-item"]:nth-child(1) .thread-starline-marker').textContent`);
  assert.match(activeMarker, /✦/);

  await window.webContents.executeJavaScript(`(() => {
    const input = document.querySelector('.aui-composer-input');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, '请确认星光是否抵达');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await clickSelector(window, 'button[aria-label="Send message"]');
  await window.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const deadline = Date.now() + 5000;
    const check = () => {
      if (document.querySelector('[data-slot="aui_thread-viewport"]').textContent.includes('星光已经')) return resolve(true);
      if (Date.now() > deadline) return reject(new Error('Timed out waiting for first thread stream'));
      setTimeout(check, 25);
    };
    check();
  })`);
  const unavailableSpeechAction = await window.webContents.executeJavaScript(
    `document.querySelector('button[aria-label="朗读"]')`,
  );
  assert.equal(unavailableSpeechAction, null);

  await clickSelector(window, '[data-testid="thread-starline-item"]:nth-child(2) [data-testid="thread-starline-trigger"]');
  await window.webContents.executeJavaScript(`(() => {
    const input = document.querySelector('.aui-composer-input');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, '请同时确认另一条星轨');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await clickSelector(window, 'button[aria-label="Send message"]');
  await window.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const deadline = Date.now() + 5000;
    const check = () => {
      if (document.querySelector('[data-slot="aui_thread-viewport"]').textContent.includes('星光已经抵达：starline-thread-2。')) return resolve(true);
      if (Date.now() > deadline) return reject(new Error('Timed out waiting for second thread stream'));
      setTimeout(check, 25);
    };
    check();
  })`);
  assert.ok(maximumConcurrentChatStreams >= 2);

  await clickSelector(window, '[data-testid="thread-starline-item"]:nth-child(1) [data-testid="thread-starline-trigger"]');
  await window.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const deadline = Date.now() + 5000;
    const check = () => {
      if (document.querySelector('[data-slot="aui_thread-viewport"]').textContent.includes('星光已经抵达：starline-thread-1。')) return resolve(true);
      if (Date.now() > deadline) return reject(new Error('Timed out waiting for restored first thread stream'));
      setTimeout(check, 25);
    };
    check();
  })`);

  const firstPersistedChatKey = messageKey("starline-thread-1", characterId);
  const secondPersistedChatKey = messageKey("starline-thread-2", characterId);
  const persistenceDeadline = Date.now() + 5000;
  while (
    (storedMessages.get(firstPersistedChatKey)?.length ?? 0) < 2 ||
    (storedMessages.get(secondPersistedChatKey)?.length ?? 0) < 2
  ) {
    if (Date.now() > persistenceDeadline) {
      throw new Error("Timed out waiting for concurrent messages to persist");
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.ok(
    storedMessages
      .get(firstPersistedChatKey)
      .some((message) =>
        JSON.stringify(message.content).includes(
          "星光已经抵达：starline-thread-1。",
        ),
      ),
  );
  assert.ok(
    storedMessages
      .get(secondPersistedChatKey)
      .some((message) =>
        JSON.stringify(message.content).includes(
          "星光已经抵达：starline-thread-2。",
        ),
      ),
  );

  await window.webContents.executeJavaScript(`(() => {
    const input = document.querySelector('.aui-composer-input');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, '请保持跨角色后台生成');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await clickSelector(window, 'button[aria-label="Send message"]');
  const crossCharacterStartDeadline = Date.now() + 5000;
  while (releaseCrossCharacterStream === undefined) {
    if (Date.now() > crossCharacterStartDeadline) {
      throw new Error("Timed out waiting for background character stream");
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  await switchCharacterFromChat(window, secondCharacter.id);
  await clickSelector(
    window,
    '[data-testid="thread-starline-item"] [data-testid="thread-starline-trigger"]',
  );
  const unconfiguredCharacterComposer = await window.webContents.executeJavaScript(`(() => {
    const input = document.querySelector('.aui-composer-input');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, '请启动月影跨角色回复');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return {
      viewportCount: document.querySelectorAll('[data-slot="aui_thread-viewport"]').length,
      sendDisabled: document.querySelector('button[aria-label="Send message"]').disabled,
      threadCount: document.querySelectorAll('[data-testid="thread-starline-item"]').length,
    };
  })()`);
  assert.deepEqual(unconfiguredCharacterComposer, {
    viewportCount: 1,
    sendDisabled: true,
    threadCount: 1,
  });

  await clickSelector(window, '[data-testid="character-launcher"]');
  await waitForSelector(window, '[data-testid="character-page"]');
  await clickSelector(window, '[data-testid="character-model"]');
  await waitForSelector(window, '[data-slot="model-selector-content"]');
  await window.webContents.executeJavaScript(`(() => {
    const item = [...document.querySelectorAll('[data-slot="model-selector-item"]')]
      .find((candidate) => candidate.textContent.includes('DeepSeek Chat'));
    if (item === undefined) throw new Error('DeepSeek model option was not found');
    item.click();
  })()`);
  const modelBindingDeadline = Date.now() + 5000;
  while (
    updatedCharacterRequest?.id !== secondCharacter.id ||
    updatedCharacterRequest?.modelConfigId !== modelId
  ) {
    if (Date.now() > modelBindingDeadline) {
      throw new Error("Timed out waiting for character model binding");
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  await clickSelector(window, '[data-testid="character-back"]');
  await waitForSelector(window, '[data-slot="aui_thread-viewport"]');
  const configuredCharacterComposer = await window.webContents.executeJavaScript(`(() => ({
    viewportCount: document.querySelectorAll('[data-slot="aui_thread-viewport"]').length,
    input: document.querySelector('.aui-composer-input').value,
    sendDisabled: document.querySelector('button[aria-label="Send message"]').disabled,
    activeThreadCount: document.querySelectorAll('[data-testid="thread-starline-item"][data-active="true"]').length,
  }))()`);
  assert.deepEqual(configuredCharacterComposer, {
    viewportCount: 1,
    input: "请启动月影跨角色回复",
    sendDisabled: false,
    activeThreadCount: 1,
  });

  await clickSelector(window, 'button[aria-label="Send message"]');
  await window.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const deadline = Date.now() + 5000;
    const check = () => {
      if (document.querySelector('[data-slot="aui_thread-viewport"]').textContent.includes('月光已经跨角色抵达：second-character-visible-thread。')) return resolve(true);
      if (Date.now() > deadline) return reject(new Error('Timed out waiting for second character stream'));
      setTimeout(check, 25);
    };
    check();
  })`);
  assert.ok(maximumConcurrentChatCharacters >= 2);

  await switchCharacterFromChat(window, characterId);
  await window.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const deadline = Date.now() + 5000;
    const check = () => {
      if (document.querySelector('[data-slot="aui_thread-viewport"]').textContent.includes('星光已经跨角色抵达：starline-thread-1。')) return resolve(true);
      if (Date.now() > deadline) return reject(new Error('Timed out waiting for restored background character stream'));
      setTimeout(check, 25);
    };
    check();
  })`);
  const restoredFirstCharacterThread = await window.webContents.executeJavaScript(`(() => ({
    viewportCount: document.querySelectorAll('[data-slot="aui_thread-viewport"]').length,
    activeThreadCount: document.querySelectorAll('[data-testid="thread-starline-item"][data-active="true"]').length,
  }))()`);
  assert.deepEqual(restoredFirstCharacterThread, {
    viewportCount: 1,
    activeThreadCount: 1,
  });

  await switchCharacterFromChat(window, secondCharacter.id);
  await window.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const deadline = Date.now() + 5000;
    const check = () => {
      if (document.querySelector('[data-slot="aui_thread-viewport"]').textContent.includes('月光已经跨角色抵达：second-character-visible-thread。')) return resolve(true);
      if (Date.now() > deadline) return reject(new Error('Timed out waiting for restored second character runtime'));
      setTimeout(check, 25);
    };
    check();
  })`);
  await switchCharacterFromChat(window, characterId);

  const crossCharacterFirstKey = messageKey("starline-thread-1", characterId);
  const crossCharacterSecondKey = messageKey(
    "second-character-visible-thread",
    secondCharacter.id,
  );
  const crossCharacterPersistenceDeadline = Date.now() + 5000;
  while (
    !storedMessages
      .get(crossCharacterFirstKey)
      ?.some((message) =>
        JSON.stringify(message.content).includes(
          "星光已经跨角色抵达：starline-thread-1。",
        ),
      ) ||
    !storedMessages
      .get(crossCharacterSecondKey)
      ?.some((message) =>
        JSON.stringify(message.content).includes(
          "月光已经跨角色抵达：second-character-visible-thread。",
        ),
      )
  ) {
    if (Date.now() > crossCharacterPersistenceDeadline) {
      throw new Error("Timed out waiting for cross-character persistence");
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  await rightClickSelector(window, '[data-testid="thread-starline-item"]:nth-child(2) [data-testid="thread-starline-trigger"]');
  const activeAfterRightClick = await window.webContents.executeJavaScript(`(() => {
    const items = [...document.querySelectorAll('[data-testid="thread-starline-item"]')];
    return items.findIndex((item) => item.getAttribute('data-active') === 'true');
  })()`);
  assert.equal(activeAfterRightClick, 0);
  await clickSelector(window, '[data-testid="thread-context-rename"]');
  await waitForSelector(window, '[data-testid="thread-rename-input"]');
  await window.webContents.executeJavaScript(`(() => {
    const input = document.querySelector('[data-testid="thread-rename-input"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '重命名后的星轨');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  })()`);
  await window.webContents.executeJavaScript(`new Promise((resolve) => setTimeout(resolve, 80))`);
  assert.equal(renamedThreadRequest.threadId, "starline-thread-2");
  assert.equal(renamedThreadRequest.title, "重命名后的星轨");

  await rightClickSelector(window, '[data-testid="thread-starline-item"]:nth-child(3) [data-testid="thread-starline-trigger"]');
  await clickSelector(window, '[data-testid="thread-context-archive"]');
  await window.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const deadline = Date.now() + 5000;
    const check = () => {
      if (!document.querySelector('[data-testid="thread-list-region"]').textContent.includes('星轨会话 3')) return resolve(true);
      if (Date.now() > deadline) return reject(new Error('Timed out waiting for archived thread to disappear'));
      setTimeout(check, 25);
    };
    check();
  })`);
  assert.deepEqual(statusThreadRequest, {
    threadId: "starline-thread-3",
    characterId,
    status: "archived",
  });
  await waitForToastMessage(window, "会话已归档。");

  await rightClickSelector(window, '[data-testid="thread-starline-item"]:nth-child(4) [data-testid="thread-starline-trigger"]');
  await clickSelector(window, '[data-testid="thread-context-delete"]');
  await waitForSelector(window, '[data-testid="confirm-dialog"]');
  const deleteThreadText = await window.webContents.executeJavaScript(`document.querySelector('[data-testid="confirm-dialog"]').innerText`);
  assert.match(deleteThreadText, /不可恢复/);
  await clickSelector(window, '[data-testid="confirm-dialog-confirm"]');
  await window.webContents.executeJavaScript(`new Promise((resolve) => setTimeout(resolve, 80))`);
  assert.equal(deletedThreadRequest.threadId, "starline-thread-5");
  await waitForToastMessage(window, "会话已删除。");

  await window.webContents.executeJavaScript(`(() => {
    const scroll = document.querySelector('[data-testid="thread-starline-scroll"]');
    scroll.scrollTop = scroll.scrollHeight;
    scroll.dispatchEvent(new Event('scroll'));
  })()`);
  await window.webContents.executeJavaScript(`new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
  const scrolledFades = await window.webContents.executeJavaScript(`({
    top: document.querySelector('[data-testid="thread-fade-top"]').getAttribute('data-visible'),
    bottom: document.querySelector('[data-testid="thread-fade-bottom"]').getAttribute('data-visible'),
  })`);
  assert.deepEqual(scrolledFades, { top: "true", bottom: "false" });

  await clickSelector(window, '[data-testid="thread-list-visibility-toggle"]');
  await window.webContents.executeJavaScript(`new Promise((resolve) => setTimeout(resolve, 260))`);
  const collapsedState = await window.webContents.executeJavaScript(`(() => {
    const region = document.querySelector('[data-testid="thread-list-region"]');
    return {
      ariaHidden: region.getAttribute('aria-hidden'),
      inert: region.inert,
      hiddenClass: region.classList.contains('is-hidden'),
      transitionDuration: getComputedStyle(region).transitionDuration,
      stored: localStorage.getItem('katarune.threadListCollapsed'),
      sidebarWidth: Math.round(document.querySelector('.chat-sidebar').getBoundingClientRect().width),
      viewportWidth: window.innerWidth,
    };
  })()`);
  assert.deepEqual(collapsedState, {
    ariaHidden: "true",
    inert: true,
    hiddenClass: true,
    transitionDuration: collapsedState.transitionDuration,
    stored: "true",
    sidebarWidth: collapsedState.sidebarWidth,
    viewportWidth: collapsedState.viewportWidth,
  });
  assert.equal(
    collapsedState.sidebarWidth,
    Math.round(
      Math.min(322, Math.max(254, collapsedState.viewportWidth * 0.23)),
    ),
  );
  assert.ok(
    collapsedState.transitionDuration.includes("0.22s") ||
      collapsedState.transitionDuration === "0s",
  );

  window.reload();
  await waitForSelector(window, '[data-testid="thread-list-region"][data-hidden="true"]');
  await clickSelector(window, '[data-testid="thread-list-visibility-toggle"]');
  await window.webContents.executeJavaScript(`new Promise((resolve) => setTimeout(resolve, 230))`);
  const expandedState = await window.webContents.executeJavaScript(`(() => {
    const region = document.querySelector('[data-testid="thread-list-region"]');
    return {
      ariaHidden: region.getAttribute('aria-hidden'),
      inert: region.inert,
      stored: localStorage.getItem('katarune.threadListCollapsed'),
    };
  })()`);
  assert.deepEqual(expandedState, {
    ariaHidden: "false",
    inert: false,
    stored: "false",
  });
  await clickSelector(window, '[data-testid="thread-starline-item"]:nth-child(1) [data-testid="thread-starline-trigger"]');
  await window.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const deadline = Date.now() + 5000;
    const check = () => {
      if (document.querySelector('[data-slot="aui_thread-viewport"]').textContent.includes('星光已经抵达：starline-thread-1。')) return resolve(true);
      if (Date.now() > deadline) return reject(new Error('Timed out waiting for restored assistant reply'));
      setTimeout(check, 25);
    };
    check();
  })`);

  window.setContentSize(760, 520);
  await window.webContents.executeJavaScript(`new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
  const minimumLayout = await window.webContents.executeJavaScript(`(() => ({
    documentScrollWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
    sidebarWidth: Math.round(document.querySelector('.chat-sidebar').getBoundingClientRect().width),
    mainWidth: Math.round(document.querySelector('.chat-main').getBoundingClientRect().width),
  }))()`);
  assert.deepEqual(minimumLayout, {
    documentScrollWidth: 760,
    viewportWidth: 760,
    sidebarWidth: 258,
    mainWidth: 502,
  });
  window.setContentSize(1080, 720);
  await window.webContents.executeJavaScript(`new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
  const standardLayout = await window.webContents.executeJavaScript(`(() => ({
    documentScrollWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
    mainWidth: Math.round(document.querySelector('.chat-main').getBoundingClientRect().width),
  }))()`);
  assert.equal(standardLayout.documentScrollWidth, standardLayout.viewportWidth);
  assert.ok(standardLayout.mainWidth > 700);
  window.setContentSize(1280, 900);
  await window.webContents.executeJavaScript(`new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
  const starlineScreenshot = await capture(window, "thread-starline-light.png");
  const darkStarlineMetrics = await window.webContents.executeJavaScript(`(async () => {
    document.documentElement.classList.add('dark');
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const sidebar = document.querySelector('.chat-sidebar').getBoundingClientRect();
    const main = document.querySelector('.chat-main').getBoundingClientRect();
    return {
      noHorizontalOverflow: document.documentElement.scrollWidth === window.innerWidth,
      sharesBackground:
        getComputedStyle(document.querySelector('.chat-sidebar')).backgroundColor ===
        getComputedStyle(document.body).backgroundColor,
      fillsViewport: Math.round(sidebar.width + main.width) === window.innerWidth,
    };
  })()`);
  assert.deepEqual(darkStarlineMetrics, {
    noHorizontalOverflow: true,
    sharesBackground: true,
    fillsViewport: true,
  });
  const darkStarlineScreenshot = await capture(window, "thread-starline-dark.png");
  await window.webContents.executeJavaScript(`document.documentElement.classList.remove('dark')`);

  console.log("UI smoke: opening character management");
  await window.webContents.executeJavaScript(`document.querySelector('[data-testid="character-launcher"]').click()`);
  await waitForSelector(window, '[data-testid="character-page"]');
  await waitForSelector(window, '[data-testid="character-list-item"]');
  const characterLayout = await window.webContents.executeJavaScript(`(() => {
    const page = document.querySelector('[data-testid="character-page"]');
    const name = document.querySelector('[data-testid="character-name"]');
    const model = document.querySelector('[data-testid="character-model"]');
    const prompt = document.querySelector('[data-testid="character-system-prompt"]');
    const list = document.querySelector('[data-testid="character-list"]');
    const listReading = document.querySelector('[data-testid="character-list-reading"]');
    const backIcon = document.querySelector('[data-testid="character-back"] svg');
    return {
      title: page.querySelector('h1').textContent.trim(),
      name: name.value,
      model: model.getAttribute('data-model-id'),
      prompt: prompt.value,
      listCount: list.querySelectorAll('[data-testid="character-list-item"]').length,
      listReading: listReading.textContent.trim(),
      columns: getComputedStyle(page.querySelector('.character-layout')).gridTemplateColumns.split(' ').length,
      backgroundImage: getComputedStyle(page).backgroundImage,
      backgroundMatchesBody: getComputedStyle(page).backgroundColor === getComputedStyle(document.body).backgroundColor,
      backTransitionDuration: getComputedStyle(backIcon).transitionDuration,
    };
  })()`);
  assert.equal(characterLayout.title, "角色图鉴");
  assert.equal(characterLayout.name, "星澜");
  assert.equal(characterLayout.model, modelId);
  assert.match(characterLayout.prompt, /温柔、沉静/);
  assert.equal(characterLayout.listCount, 2);
  assert.equal(characterLayout.listReading, "Xing Lan");
  assert.equal(characterLayout.columns, 3);
  assert.equal(characterLayout.backgroundImage, "none");
  assert.equal(characterLayout.backgroundMatchesBody, true);
  assert.equal(characterLayout.backTransitionDuration, "0.16s");

  await window.webContents.executeJavaScript(`document.querySelector('[data-testid="character-model"]').click()`);
  await waitForSelector(window, '[data-slot="model-selector-content"]');
  const modelSelector = await window.webContents.executeJavaScript(`(() => {
    const content = document.querySelector('[data-slot="model-selector-content"]');
    const groups = [...content.querySelectorAll('[data-slot="model-selector-group"]')];
    const selectedItem = content.querySelector('[data-slot="model-selector-item"][data-selected="true"]')
      ?? [...content.querySelectorAll('[data-slot="model-selector-item"]')].find((item) => item.textContent.includes('DeepSeek Chat'));
    const providerLogo = selectedItem.querySelector('span[style*="mask-image"]');
    return {
      hasSearch: content.querySelector('[data-slot="model-selector-search"]') !== null,
      groupLabels: groups.map((group) => group.textContent.trim()),
      selectedText: selectedItem.textContent.trim(),
      hasProviderLogo: providerLogo !== null && getComputedStyle(providerLogo).maskImage !== "none",
    };
  })()`);
  assert.equal(modelSelector.hasSearch, true);
  assert.ok(modelSelector.groupLabels.some((label) => label.includes("DeepSeek")));
  assert.match(modelSelector.selectedText, /DeepSeek Chat/);
  assert.equal(modelSelector.hasProviderLogo, true);
  window.webContents.sendInputEvent({ type: "keyDown", keyCode: "ESC" });
  window.webContents.sendInputEvent({ type: "keyUp", keyCode: "ESC" });

  await window.webContents.executeJavaScript(`(() => {
    const input = document.querySelector('[data-testid="character-name"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '星澜·测试');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  })()`);
  await window.webContents.executeJavaScript(`new Promise((resolve) => setTimeout(resolve, 50))`);
  assert.deepEqual(updatedCharacterRequest, { id: characterId, name: "星澜·测试" });
  const characterScreenshot = await capture(window, "character-gallery.png");

  const characterCreateButton = await window.webContents.executeJavaScript(`(() => {
    const button = document.querySelector('[data-testid="character-create"]');
    return {
      ariaLabel: button.getAttribute('aria-label'),
      hasIcon: button.querySelector('svg') !== null,
      visibleText: [...button.childNodes]
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent.trim())
        .filter(Boolean),
    };
  })()`);
  assert.deepEqual(characterCreateButton, {
    ariaLabel: "新增角色",
    hasIcon: true,
    visibleText: [],
  });
  await clickSelector(window, '[data-testid="character-create"]');
  await window.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const deadline = Date.now() + 5000;
    const check = () => {
      if (document.querySelectorAll('[data-testid="character-list-item"]').length === 3) return resolve(true);
      if (Date.now() > deadline) return reject(new Error('Timed out waiting for character creation'));
      setTimeout(check, 25);
    };
    check();
  })`);
  const createdCharacterUi = await window.webContents.executeJavaScript(`(() => {
    const name = document.querySelector('[data-testid="character-name"]');
    return {
      name: name.value,
      modelId: document.querySelector('[data-testid="character-model"]').getAttribute('data-model-id'),
      prompt: document.querySelector('[data-testid="character-system-prompt"]').value,
      focused: document.activeElement === name,
      selection: [name.selectionStart, name.selectionEnd],
      dialogOpen: document.querySelector('[data-testid="confirm-dialog"]') !== null,
      selectedIndex: [...document.querySelectorAll('[data-testid="character-list-item"]')]
        .findIndex((item) => item.getAttribute('data-selected') === 'true'),
    };
  })()`);
  assert.deepEqual(createdCharacterUi, {
    name: "未命名角色",
    modelId: "",
    prompt: "",
    focused: true,
    selection: [0, 5],
    dialogOpen: false,
    selectedIndex: 0,
  });
  assert.equal(createdCharacterCount, 0, "未离开新角色前不应写入数据库");

  await window.webContents.executeJavaScript(
    `document.querySelectorAll('[data-testid="character-list-item"]')[2].click()`,
  );
  await window.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const deadline = Date.now() + 5000;
    const check = () => {
      if (
        document.querySelectorAll('[data-testid="character-list-item"]').length === 2 &&
        document.querySelector('[data-testid="character-name"]').value === '月影'
      ) return resolve(true);
      if (Date.now() > deadline) return reject(new Error('Timed out waiting for unchanged draft discard'));
      setTimeout(check, 25);
    };
    check();
  })`);
  assert.equal(createdCharacterCount, 0, "无改动草稿离开时应直接丢弃");

  await clickSelector(window, '[data-testid="character-create"]');
  await window.webContents.executeJavaScript(`(() => {
    const input = document.querySelector('[data-testid="character-name"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '流萤');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await window.webContents.executeJavaScript(
    `document.querySelectorAll('[data-testid="character-list-item"]')[1].click()`,
  );
  await window.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const deadline = Date.now() + 5000;
    const check = () => {
      if (
        document.querySelectorAll('[data-testid="character-list-item"]').length === 3 &&
        document.querySelector('[data-testid="character-name"]').value === '星澜·测试'
      ) return resolve(true);
      if (Date.now() > deadline) return reject(new Error('Timed out waiting for changed draft persistence'));
      setTimeout(check, 25);
    };
    check();
  })`);
  assert.equal(createdCharacterCount, 1);
  assert.deepEqual(createdCharacterRequest, {
    name: "流萤",
    modelConfigId: null,
    speechModelConfigId: null,
    speechVoice: null,
    systemPrompt: "",
  });
  const createdCharacterId = characters[0].id;

  await rightClickSelector(
    window,
    `[data-character-id="${createdCharacterId}"] [data-testid="character-list-item"]`,
    '[data-testid="character-context-menu"]',
  );
  const characterContextMenu = await window.webContents.executeJavaScript(`(() => ({
    selectedName: document.querySelector('[data-testid="character-name"]').value,
    characterClass: document.querySelector('[data-testid="character-context-menu"]').className,
    threadClass: 'thread-context-menu',
    dangerClass: document.querySelector('[data-testid="character-context-delete"]').className,
  }))()`);
  assert.equal(characterContextMenu.selectedName, "星澜·测试");
  assert.match(characterContextMenu.characterClass, /thread-context-menu/);
  assert.match(characterContextMenu.dangerClass, /thread-context-menu-danger/);
  await clickSelector(window, '[data-testid="character-context-delete"]');
  await waitForSelector(window, '[data-testid="confirm-dialog"]');
  const cancelDeleteText = await window.webContents.executeJavaScript(
    `document.querySelector('[data-testid="confirm-dialog"]').innerText`,
  );
  assert.match(cancelDeleteText, /删除「流萤」[\s\S]*0 个会话[\s\S]*不可恢复/);
  await clickSelector(window, '[data-testid="confirm-dialog-cancel"]');

  await rightClickSelector(
    window,
    `[data-character-id="${createdCharacterId}"] [data-testid="character-list-item"]`,
    '[data-testid="character-context-menu"]',
  );
  await clickSelector(window, '[data-testid="character-context-delete"]');
  await waitForSelector(window, '[data-testid="confirm-dialog"]');
  const createdDeleteText = await window.webContents.executeJavaScript(
    `document.querySelector('[data-testid="confirm-dialog"]').innerText`,
  );
  assert.match(createdDeleteText, /0 个会话/);
  await clickSelector(window, '[data-testid="confirm-dialog-confirm"]');
  await window.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const deadline = Date.now() + 5000;
    const check = () => {
      if (document.querySelectorAll('[data-testid="character-list-item"]').length === 2) return resolve(true);
      if (Date.now() > deadline) return reject(new Error('Timed out waiting for new character deletion'));
      setTimeout(check, 25);
    };
    check();
  })`);
  assert.equal(deletedCharacterRequest.id, createdCharacterId);
  await waitForToastMessage(window, "角色已删除。");
  const selectionAfterDelete = await window.webContents.executeJavaScript(
    `document.querySelector('[data-testid="character-name"]').value`,
  );
  assert.equal(selectionAfterDelete, "星澜·测试");

  await rightClickSelector(
    window,
    `[data-character-id="${characterId}"] [data-testid="character-list-item"]`,
    '[data-testid="character-context-menu"]',
  );
  await clickSelector(window, '[data-testid="character-context-delete"]');
  await waitForSelector(window, '[data-testid="confirm-dialog"]');
  await clickSelector(window, '[data-testid="confirm-dialog-confirm"]');
  await window.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const deadline = Date.now() + 5000;
    const check = () => {
      if (document.querySelectorAll('[data-testid="character-list-item"]').length === 1) return resolve(true);
      if (Date.now() > deadline) return reject(new Error('Timed out waiting for active character deletion'));
      setTimeout(check, 25);
    };
    check();
  })`);
  assert.equal(activeCharacterId, secondCharacter.id);
  await rightClickSelector(
    window,
    '[data-testid="character-list-item"]',
    '[data-testid="character-context-menu"]',
  );
  const onlyCharacterDeleteDisabled = await window.webContents.executeJavaScript(
    `document.querySelector('[data-testid="character-context-delete"]').hasAttribute('data-disabled')`,
  );
  assert.equal(onlyCharacterDeleteDisabled, true);
  window.webContents.sendInputEvent({ type: "keyDown", keyCode: "ESC" });
  window.webContents.sendInputEvent({ type: "keyUp", keyCode: "ESC" });

  await window.webContents.executeJavaScript(`document.querySelector('[data-testid="character-back"]').click()`);
  await waitForSelector(window, '[data-testid="settings-launcher"]');
  assert.equal(activeCharacterId, secondCharacter.id);
  const activeCardName = await window.webContents.executeJavaScript(
    `document.querySelector('[data-testid="character-launcher"] strong').textContent`,
  );
  assert.equal(activeCardName, "月影");
  await window.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const deadline = Date.now() + 5000;
    const check = () => {
      const region = document.querySelector('[data-testid="thread-list-region"]');
      if (region?.textContent.includes('只属于月影的会话')) return resolve(true);
      if (Date.now() > deadline) return reject(new Error('Timed out waiting for character-scoped threads'));
      setTimeout(check, 25);
    };
    check();
  })`);
  const switchedCharacterThreads = await window.webContents.executeJavaScript(`(() => ({
    count: document.querySelectorAll('[data-testid="thread-starline-item"]').length,
    text: document.querySelector('[data-testid="thread-list-region"]').textContent,
    activeCount: document.querySelectorAll('[data-testid="thread-starline-item"][data-active="true"]').length,
  }))()`);
  assert.equal(switchedCharacterThreads.count, 1);
  assert.match(switchedCharacterThreads.text, /只属于月影的会话/);
  assert.doesNotMatch(switchedCharacterThreads.text, /雨停后的第一封信/);
  assert.equal(switchedCharacterThreads.activeCount, 0);
  await clickSelector(
    window,
    '[data-testid="thread-starline-item"] [data-testid="thread-starline-trigger"]',
  );
  await window.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const deadline = Date.now() + 5000;
    const check = () => {
      if (document.querySelector('[data-slot="aui_thread-viewport"]').textContent.includes('月光已经跨角色抵达：second-character-visible-thread。')) return resolve(true);
      if (Date.now() > deadline) return reject(new Error('Timed out waiting for reloaded second character history'));
      setTimeout(check, 25);
    };
    check();
  })`);

  await clickSelector(window, '[data-testid="thread-new"]');
  await window.webContents.executeJavaScript(`(() => {
    const input = document.querySelector('.aui-composer-input');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, '请为月下新谈命名');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await clickSelector(window, 'button[aria-label="Send message"]');
  await window.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const deadline = Date.now() + 5000;
    const check = () => {
      if (document.querySelector('[data-testid="thread-list-region"]')?.textContent.includes('星光下的请为月下新谈命名')) return resolve(true);
      if (Date.now() > deadline) return reject(new Error('Timed out waiting for generated thread title'));
      setTimeout(check, 25);
    };
    check();
  })`);
  assert.equal(generatedThreadTitleRequest.characterId, secondCharacter.id);
  assert.deepEqual(generatedThreadTitleRequest.messages[0], {
    role: "user",
    text: "请为月下新谈命名",
  });

  console.log("UI smoke: opening settings");
  await window.webContents.executeJavaScript(`document.querySelector('[data-testid="settings-launcher"]').click()`);
  await waitForSelector(window, '[data-testid="settings-page"]');
  await waitForSelector(window, '[data-testid="theme-light"]');

  const settingsNavigation = await window.webContents.executeJavaScript(`(() => ({
    general: document.querySelector('[data-testid="settings-tab-general"]').textContent.trim(),
    models: document.querySelector('[data-testid="settings-tab-models"]').textContent.trim(),
    generalSelected: document.querySelector('[data-testid="settings-tab-general"]').getAttribute('data-active') !== null,
  }))()`);
  assert.deepEqual(settingsNavigation, { general: "常规", models: "模型", generalSelected: true });

  await window.webContents.executeJavaScript(`document.querySelector('[data-testid="theme-dark"]').click()`);
  const darkThemeSelected = await window.webContents.executeJavaScript(`document.documentElement.classList.contains('dark')`);
  assert.equal(darkThemeSelected, true);
  await window.webContents.executeJavaScript(`document.querySelector('[data-testid="theme-light"]').click()`);
  const lightThemeSelected = await window.webContents.executeJavaScript(`!document.documentElement.classList.contains('dark')`);
  assert.equal(lightThemeSelected, true);

  await window.webContents.executeJavaScript(`document.querySelector('[data-testid="settings-tab-models"]').click()`);
  await waitForSelector(window, '[data-testid="model-row"]');

  await hoverSelector(window, '[data-testid="settings-tab-models"]');
  const activeNavigationHover = await window.webContents.executeJavaScript(`(() => {
    const style = getComputedStyle(document.querySelector('[data-testid="settings-tab-models"]'));
    return { background: style.backgroundColor, foreground: style.color };
  })()`);
  assert.notEqual(activeNavigationHover.foreground, activeNavigationHover.background);

  await hoverSelector(window, '[data-testid="model-categories"] [data-active]');
  const activeCategoryHover = await window.webContents.executeJavaScript(`(() => {
    const element = document.querySelector('[data-testid="model-categories"] [data-active]');
    return { background: getComputedStyle(element, '::before').backgroundColor, foreground: getComputedStyle(element).color, fontSize: getComputedStyle(element).fontSize };
  })()`);
  assert.notEqual(activeCategoryHover.foreground, activeCategoryHover.background);
  assert.equal(activeCategoryHover.fontSize, "10px");
  const hoverScreenshot = await capture(window, "hover-states.png");

  const settingsLayout = await window.webContents.executeJavaScript(`(() => {
    const page = document.querySelector('[data-testid="settings-page"]');
    const backElement = document.querySelector('[data-testid="settings-back"]');
    const back = backElement.getBoundingClientRect();
    const rect = page.getBoundingClientRect();
    return {
      hasExternalLauncher: document.querySelector('[data-testid="settings-launcher"]') !== null,
      hasPageHeader: page.querySelector('header') !== null,
      left: Math.round(rect.left),
      top: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      pageOverflow: getComputedStyle(page).overflow,
      backLeft: Math.round(back.left),
      backTop: Math.round(back.top),
      backWidth: Math.round(back.width),
      backHeight: Math.round(back.height),
      backTransitionDuration: getComputedStyle(backElement.querySelector('svg')).transitionDuration,
    };
  })()`);
  assert.equal(settingsLayout.hasExternalLauncher, false);
  assert.equal(settingsLayout.hasPageHeader, true);
  assert.deepEqual(
    { left: settingsLayout.left, top: settingsLayout.top, width: settingsLayout.width, height: settingsLayout.height },
    { left: 0, top: 0, width: settingsLayout.viewportWidth, height: settingsLayout.viewportHeight },
  );
  assert.equal(settingsLayout.pageOverflow, "hidden");
  assert.equal(settingsLayout.backLeft, 32);
  assert.equal(settingsLayout.backTop, 17);
  assert.equal(settingsLayout.backWidth, launcherMetrics.width);
  assert.equal(settingsLayout.backHeight, launcherMetrics.height);
  assert.equal(settingsLayout.backTransitionDuration, characterLayout.backTransitionDuration);

  window.setSize(375, 700);
  await window.webContents.executeJavaScript(`new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
  const compactLayout = await window.webContents.executeJavaScript(`(() => {
    const page = document.querySelector('[data-testid="settings-page"]');
    const workspace = document.querySelector('[data-testid="settings-workspace"]').getBoundingClientRect();
    const back = document.querySelector('[data-testid="settings-back"]').getBoundingClientRect();
    const generalTab = document.querySelector('[data-testid="settings-tab-general"]').getBoundingClientRect();
    const modelTab = document.querySelector('[data-testid="settings-tab-models"]').getBoundingClientRect();
    const provider = document.querySelector('[data-testid="provider-list"]').closest('[data-slot="card"]').getBoundingClientRect();
    const model = document.querySelector('[data-testid="model-row"]').closest('[data-slot="card"]').getBoundingClientRect();
    return {
      pageWidth: Math.round(page.getBoundingClientRect().width),
      viewportWidth: window.innerWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      backLeft: Math.round(back.left),
      backTop: Math.round(back.top),
      tabsInline: Math.round(generalTab.top) === Math.round(modelTab.top) && generalTab.right <= modelTab.left,
      panelsStacked: provider.bottom <= model.top,
      contentLeft: Math.round(provider.left),
      contentRight: Math.round(workspace.right - provider.right),
    };
  })()`);
  assert.equal(compactLayout.pageWidth, compactLayout.viewportWidth);
  assert.equal(compactLayout.documentScrollWidth, compactLayout.viewportWidth);
  assert.equal(compactLayout.backLeft, 24);
  assert.equal(compactLayout.backTop, 17);
  assert.equal(compactLayout.tabsInline, true);
  assert.equal(compactLayout.panelsStacked, true);
  assert.equal(compactLayout.contentLeft, 24);
  assert.equal(compactLayout.contentRight, 24);
  window.setSize(1280, 900);
  await window.webContents.executeJavaScript(`new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);

  const settingsText = await window.webContents.executeJavaScript(`document.querySelector("main").textContent`);
  assert.match(settingsText, /DeepSeek Chat/);
  assert.doesNotMatch(settingsText, /Registry ID/);
  assert.doesNotMatch(settingsText, /外观|普拉娜|阿洛娜/);

  const modelCategories = await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[data-testid="model-categories"] [data-slot="tabs-trigger"]'), (element) => element.textContent.trim())`);
  assert.deepEqual(modelCategories, ["全部", "语言", "嵌入", "图像", "语音识别", "语音生成", "重排序", "视频"]);
  const modelLayout = await window.webContents.executeJavaScript(`(() => {
    const providerCard = document.querySelector('[data-testid="provider-list"]').closest('[data-slot="card"]').getBoundingClientRect();
    const modelCard = document.querySelector('[data-testid="model-row"]').closest('[data-slot="card"]').getBoundingClientRect();
    const categoryBar = document.querySelector('[data-testid="model-categories"]').getBoundingClientRect();
    const categoryTabs = Array.from(document.querySelectorAll('[data-testid="model-categories"] [data-slot="tabs-trigger"]'), (element) => element.getBoundingClientRect());
    return {
      providerRight: Math.round(providerCard.right),
      modelLeft: Math.round(modelCard.left),
      categoryTopCount: new Set(categoryTabs.map((rect) => Math.round(rect.top))).size,
      categoryCenterOffset: Math.round((categoryBar.left + categoryBar.right - modelCard.left - modelCard.right) / 2),
    };
  })()`);
  assert.ok(modelLayout.providerRight < modelLayout.modelLeft);
  assert.equal(modelLayout.categoryTopCount, 1);
  assert.equal(modelLayout.categoryCenterOffset, 0);
  window.webContents.sendInputEvent({ type: "mouseMove", x: 1, y: 1 });
  await window.webContents.executeJavaScript(`new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
  const modelItemStyle = await window.webContents.executeJavaScript(`(() => {
    const row = document.querySelector('[data-testid="model-row"]');
    const style = getComputedStyle(row);
    const foregroundText = getComputedStyle(document.querySelector('[data-slot="card-title"]'));
    return {
      height: row.getBoundingClientRect().height,
      hasDefaultBackground: style.backgroundColor !== "rgba(0, 0, 0, 0)",
      defaultColorMatchesForeground: style.color === foregroundText.color,
      borderWidth: style.borderTopWidth,
      radius: Number.parseFloat(style.borderRadius),
      actionOpacity: getComputedStyle(document.querySelector('[data-testid="model-actions"]')).opacity,
      typeLabel: row.querySelector('[aria-label="语言模型"]')?.getAttribute('aria-label'),
      switchLabel: row.querySelector('[data-slot="switch"]')?.getAttribute('aria-label'),
    };
  })()`);
  assert.equal(modelItemStyle.height, 40);
  assert.equal(modelItemStyle.hasDefaultBackground, false);
  assert.equal(modelItemStyle.defaultColorMatchesForeground, true);
  assert.equal(modelItemStyle.borderWidth, "0px");
  assert.ok(modelItemStyle.radius > 0 && modelItemStyle.radius <= 8);
  assert.equal(modelItemStyle.actionOpacity, "0");
  assert.equal(modelItemStyle.typeLabel, "语言模型");
  assert.equal(modelItemStyle.switchLabel, "DeepSeek Chat启用状态");
  await hoverSelector(window, '[data-testid="model-row"]');
  await window.webContents.executeJavaScript(`new Promise((resolve) => setTimeout(resolve, 200))`);
  const modelActions = await window.webContents.executeJavaScript(`({
    opacity: getComputedStyle(document.querySelector('[data-testid="model-actions"]')).opacity,
    labels: Array.from(document.querySelectorAll('[data-testid="model-actions"] .sr-only'), (element) => element.textContent),
    deleteUsesNormalColor: getComputedStyle(document.querySelector('[data-testid="delete-model"]')).color === getComputedStyle(document.querySelector('[data-testid="edit-model"]')).color,
    textUsesForeground: getComputedStyle(document.querySelector('[data-testid="model-row"]')).color === getComputedStyle(document.querySelector('[data-slot="card-title"]')).color,
  })`);
  assert.deepEqual(modelActions, { opacity: "1", labels: ["测试连接（会调用供应商并可能产生费用）", "编辑模型", "删除模型"], deleteUsesNormalColor: true, textUsesForeground: true });
  await clickSelector(window, '[data-testid="model-row"] [data-slot="switch"]');
  const modelSwitchSettled = await window.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const deadline = Date.now() + 5000;
    let stableSince = null;
    const check = () => {
      const modelSwitch = document.querySelector('[data-testid="model-row"] [data-slot="switch"]');
      const isSettled = modelSwitch?.hasAttribute('data-unchecked') && !modelSwitch.hasAttribute('data-disabled');
      if (isSettled) {
        stableSince ??= Date.now();
        if (Date.now() - stableSince >= 150) return resolve(true);
      } else {
        stableSince = null;
      }
      if (Date.now() > deadline) return reject(new Error('Timed out waiting for model switch update'));
      setTimeout(check, 25);
    };
    check();
  })`);
  assert.equal(updatedModelRequest.enabled, false);
  assert.equal(modelSwitchSettled, true);
  await hoverSelector(window, '[data-testid="model-search"]');
  await window.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const deadline = Date.now() + 1000;
    const check = () => {
      const opacity = getComputedStyle(document.querySelector('[data-testid="model-actions"]')).opacity;
      if (opacity === "0") return resolve(true);
      if (Date.now() > deadline) return reject(new Error('Timed out waiting for model actions to hide'));
      requestAnimationFrame(check);
    };
    check();
  })`);
  const modelActionsAfterToggle = await window.webContents.executeJavaScript(`getComputedStyle(document.querySelector('[data-testid="model-actions"]')).opacity`);
  assert.equal(modelActionsAfterToggle, "0");
  const modelToolbar = await window.webContents.executeJavaScript(`(() => {
    const search = document.querySelector('[data-testid="model-search"]');
    const header = search.closest('[data-slot="card-header"]');
    const isRound = (element) => {
      const rect = element.getBoundingClientRect();
      return Number.parseFloat(getComputedStyle(element).borderRadius) * 2 >= Math.min(rect.width, rect.height);
    };
    const iconButtons = ['[data-testid="add-provider"]', '[data-testid="add-model"]', '[data-testid="discover-models"]'].map((selector) => document.querySelector(selector));
    const referenceButton = iconButtons[1].getBoundingClientRect();
    return {
      placeholder: search.placeholder,
      buttons: Array.from(header.querySelectorAll('button'), (button) => button.querySelector('.sr-only')?.textContent),
      hasTitle: header.querySelector('[data-slot="card-title"]') !== null,
      hasProviderSettings: document.querySelector('[data-testid="provider-settings"]') !== null,
      searchIsRounded: isRound(search),
      iconButtonsAreRound: iconButtons.every(isRound),
      iconButtonsHaveSameSize: iconButtons.every((button) => {
        const rect = button.getBoundingClientRect();
        return rect.width === referenceButton.width && rect.height === referenceButton.height;
      }),
    };
  })()`);
  assert.deepEqual(modelToolbar, {
    placeholder: "搜索模型",
    buttons: ["添加模型", "获取模型列表"],
    hasTitle: false,
    hasProviderSettings: false,
    searchIsRounded: true,
    iconButtonsAreRound: true,
    iconButtonsHaveSameSize: true,
  });
  const providerRows = await window.webContents.executeJavaScript(`document.querySelectorAll('[data-testid="provider-row"]').length`);
  assert.equal(providerRows, 1);
  const providerItemStyle = await window.webContents.executeJavaScript(`(() => {
    const providerElement = document.querySelector('[data-testid="provider-row"]');
    const activeTabElement = document.querySelector('[data-testid="settings-tab-models"]');
    const categoryElement = document.querySelector('[data-testid="model-categories"] [data-slot="tabs-list"]');
    const providerTitle = document.querySelector('[data-testid="provider-list"]')?.previousElementSibling?.querySelector('[data-slot="card-title"]');
    const addProviderButton = document.querySelector('[data-testid="add-provider"]');
    const provider = getComputedStyle(providerElement);
    const activeTab = getComputedStyle(activeTabElement);
    const providerTitleRect = providerTitle.getBoundingClientRect();
    const addProviderRect = addProviderButton.getBoundingClientRect();
    return {
      providerHeaderCenterOffset: Math.round(providerTitleRect.top + providerTitleRect.height / 2 - addProviderRect.top - addProviderRect.height / 2),
      menuHeight: activeTabElement.getBoundingClientRect().height,
      providerHeight: providerElement.getBoundingClientRect().height,
      categoryHeight: categoryElement.getBoundingClientRect().height,
      borderWidth: provider.borderTopWidth,
      radius: Number.parseFloat(provider.borderRadius),
      backgroundMatchesTab: provider.backgroundColor === activeTab.backgroundColor,
      colorMatchesTab: provider.color === activeTab.color,
    };
  })()`);
  assert.equal(providerItemStyle.providerHeaderCenterOffset, 0);
  assert.equal(providerItemStyle.menuHeight, 44);
  assert.equal(providerItemStyle.providerHeight, 40);
  assert.equal(providerItemStyle.categoryHeight, 32);
  assert.equal(providerItemStyle.borderWidth, "0px");
  assert.ok(providerItemStyle.radius > 0 && providerItemStyle.radius <= 8);
  assert.equal(providerItemStyle.backgroundMatchesTab, true);
  assert.equal(providerItemStyle.colorMatchesTab, true);
  const providerListText = await window.webContents.executeJavaScript(`document.querySelector('[data-testid="provider-list"]').textContent`);
  assert.doesNotMatch(providerListText, /已启用|已停用/);
  await hoverSelector(window, '[data-testid="provider-row"]');
  await window.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const deadline = Date.now() + 1000;
    const check = () => {
      const opacity = getComputedStyle(document.querySelector('[data-testid="provider-actions"]')).opacity;
      if (opacity === "1") return resolve(true);
      if (Date.now() > deadline) return reject(new Error('Timed out waiting for provider actions to show'));
      requestAnimationFrame(check);
    };
    check();
  })`);
  const providerActions = await window.webContents.executeJavaScript(`(() => {
    const actions = document.querySelector('[data-testid="provider-actions"]');
    return {
      opacity: getComputedStyle(actions).opacity,
      editLabel: document.querySelector('[data-testid="edit-provider"] .sr-only').textContent,
      deleteLabel: document.querySelector('[data-testid="delete-provider"] .sr-only').textContent,
    };
  })()`);
  assert.deepEqual(providerActions, { opacity: "1", editLabel: "编辑供应商", deleteLabel: "删除供应商" });

  await window.webContents.executeJavaScript(`document.querySelector('[data-testid="discover-models"]').click()`);
  await Promise.all([
    waitForSelector(window, '[data-testid="discovered-model-row"]'),
    waitForToastMessage(window, "获取到 2 个模型。"),
  ]);
  const discoveredCount = await window.webContents.executeJavaScript(`document.querySelectorAll('[data-testid="discovered-model-row"]').length`);
  assert.equal(discoveredCount, 1);
  const discoveryFeedback = await window.webContents.executeJavaScript(`({
    inlineMessages: Array.from(document.querySelectorAll('[data-notification-scope]'), (element) => element.textContent),
    modelAreaInlineCount: document.querySelectorAll('[data-notification-scope^="settings.models:"]').length,
  })`);
  assert.equal(discoveryFeedback.inlineMessages.some((message) => message.includes("获取到 2 个模型。")), false);
  assert.equal(discoveryFeedback.modelAreaInlineCount, 0);
  const categoryColumns = await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[data-testid="model-type-icon"]'), (element) => Math.round(element.getBoundingClientRect().left))`);
  assert.equal(new Set(categoryColumns).size, 1);
  const discoveredRowStyle = await window.webContents.executeJavaScript(`(() => {
    const configuredName = document.querySelector('[data-testid="model-row"] > :first-child');
    const discoveredRow = document.querySelector('[data-testid="discovered-model-row"]');
    const discoveredName = discoveredRow.firstElementChild;
    return {
      containsUnconfiguredLabel: discoveredRow.textContent.includes("未配置"),
      usesMutedName: getComputedStyle(discoveredName).color !== getComputedStyle(configuredName).color,
      configuredColumns: getComputedStyle(document.querySelector('[data-testid="model-row"]')).gridTemplateColumns,
      discoveredColumns: getComputedStyle(discoveredRow).gridTemplateColumns,
    };
  })()`);
  assert.equal(discoveredRowStyle.containsUnconfiguredLabel, false);
  assert.equal(discoveredRowStyle.usesMutedName, true);
  assert.equal(discoveredRowStyle.discoveredColumns, discoveredRowStyle.configuredColumns);
  await window.webContents.executeJavaScript(`(() => {
    const input = document.querySelector('[data-testid="model-search"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'deepseek-v4-pro');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await window.webContents.executeJavaScript(`new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
  const searchedModels = await window.webContents.executeJavaScript(`({ configured: document.querySelectorAll('[data-testid="model-row"]').length, discovered: document.querySelectorAll('[data-testid="discovered-model-row"]').length })`);
  assert.deepEqual(searchedModels, { configured: 0, discovered: 1 });
  await window.webContents.executeJavaScript(`document.querySelector('[data-testid="discovered-model-row"] button').click()`);
  await waitForSelector(window, "#model-id");
  const discoveredModelDraft = await window.webContents.executeJavaScript(`({ id: document.querySelector('#model-id').value, name: document.querySelector('#model-name').value, type: document.querySelector('#model-type').value })`);
  assert.deepEqual(discoveredModelDraft, { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro", type: "languageModel" });
  await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[data-slot="dialog-content"] button')).find((button) => button.textContent.trim() === "取消").click()`);
  await window.webContents.executeJavaScript(`new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
  await window.webContents.executeJavaScript(`(() => {
    const input = document.querySelector('[data-testid="model-search"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await window.webContents.executeJavaScript(`new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);

  await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[data-testid="model-categories"] [data-slot="tabs-trigger"]')).find((element) => element.textContent.trim() === "嵌入").click()`);
  await window.webContents.executeJavaScript(`new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
  const embeddingModels = await window.webContents.executeJavaScript(`document.querySelectorAll('[data-testid="model-row"]').length`);
  assert.equal(embeddingModels, 0);
  const emptyCategoryText = await window.webContents.executeJavaScript(`document.querySelector("main").textContent`);
  assert.match(emptyCategoryText, /此分类还没有模型/);
  const emptyCategoryStyle = await window.webContents.executeJavaScript(`(() => {
    const empty = document.querySelector('[data-testid="model-empty-state"]');
    const style = getComputedStyle(empty);
    const content = empty.firstElementChild.getBoundingClientRect();
    const bounds = empty.getBoundingClientRect();
    return {
      borderWidth: style.borderTopWidth,
      horizontalOffset: Math.round(content.left + content.right - bounds.left - bounds.right),
      verticalOffset: Math.round(content.top + content.bottom - bounds.top - bounds.bottom),
    };
  })()`);
  assert.deepEqual(emptyCategoryStyle, { borderWidth: "0px", horizontalOffset: 0, verticalOffset: 0 });
  await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[data-testid="model-categories"] [data-slot="tabs-trigger"]')).find((element) => element.textContent.trim() === "全部").click()`);
  await window.webContents.executeJavaScript(`new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
  await waitForSelector(window, '[data-testid="model-row"]');

  await window.webContents.executeJavaScript(`document.querySelector('[data-testid="edit-provider"]').click()`);
  await waitForSelector(window, "#provider-secret");
  const providerSettings = await window.webContents.executeJavaScript(`(() => {
    const dialog = document.querySelector('#provider-secret').closest('[data-slot="dialog-content"]');
    return {
      text: dialog.innerText,
      typeDisabled: document.querySelector('#provider-type').disabled,
      hasEnabledOption: document.querySelector('#provider-enabled') !== null,
      urlPlaceholder: document.querySelector('#provider-url').placeholder,
    };
  })()`);
  assert.match(providerSettings.text, /编辑供应商/);
  assert.doesNotMatch(providerSettings.text, /安全凭据|已启用|已停用/);
  assert.equal(providerSettings.typeDisabled, true);
  assert.equal(providerSettings.hasEnabledOption, false);
  assert.equal(providerSettings.urlPlaceholder, "https://api.deepseek.com");
  await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[data-slot="dialog-content"] button')).find((button) => button.textContent.trim() === "取消").click()`);
  await waitForSelector(window, '[data-testid="model-row"]');

  await window.webContents.executeJavaScript(`document.querySelector('[data-testid="delete-model"]').click()`);
  await waitForSelector(window, '[data-testid="confirm-dialog"]');
  const deleteModelDialogText = await window.webContents.executeJavaScript(`document.querySelector('[data-testid="confirm-dialog"]').innerText`);
  assert.match(deleteModelDialogText, /删除模型[\s\S]*确定删除“DeepSeek Chat”吗？[\s\S]*取消[\s\S]*删除模型/);
  await window.webContents.executeJavaScript(`document.querySelector('[data-testid="confirm-dialog-cancel"]').click()`);
  await window.webContents.executeJavaScript(`new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);

  await window.webContents.executeJavaScript(`document.querySelector('[data-testid="edit-model"]').click()`);
  await waitForSelector(window, "#model-type");
  const modelTypeOptions = await window.webContents.executeJavaScript(`(() => {
    const select = document.querySelector("#model-type");
    const fields = [
      select.closest("div.grid"),
      document.querySelector("#model-id").closest("div.grid"),
      document.querySelector("#model-name").closest("div.grid"),
    ].map((element) => element.getBoundingClientRect());
    return {
      value: select.value,
      options: Array.from(select.options, (option) => option.value),
      usesDialog: select.closest('[data-slot="dialog-content"]') !== null,
      fieldsAreVertical: fields.every((rect, index) => index === 0 || fields[index - 1].bottom <= rect.top),
      title: select.closest('[data-slot="dialog-content"]').innerText,
    };
  })()`);
  assert.equal(modelTypeOptions.value, "languageModel");
  assert.equal(modelTypeOptions.usesDialog, true);
  assert.equal(modelTypeOptions.fieldsAreVertical, true);
  assert.match(modelTypeOptions.title, /编辑模型/);
  assert.deepEqual(modelTypeOptions.options, [
    "languageModel",
    "embeddingModel",
    "imageModel",
    "transcriptionModel",
    "speechModel",
    "rerankingModel",
    "videoModel",
  ]);
  await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[data-slot="dialog-content"] button')).find((button) => button.textContent.trim() === "取消").click()`);
  await window.webContents.executeJavaScript(`new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
  await window.webContents.executeJavaScript(`document.querySelector('[data-testid="add-model"]').click()`);
  await waitForSelector(window, "#model-type");
  const addModelDialog = await window.webContents.executeJavaScript(`(() => {
    const select = document.querySelector("#model-type");
    return {
      text: select.closest('[data-slot="dialog-content"]').innerText,
      value: select.value,
      required: select.required,
    };
  })()`);
  assert.match(addModelDialog.text, /添加模型[\s\S]*模型类别[\s\S]*厂商模型 ID[\s\S]*显示名称/);
  assert.doesNotMatch(addModelDialog.text, /启用模型/);
  assert.equal(addModelDialog.value, "");
  assert.equal(addModelDialog.required, true);
  await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[data-slot="dialog-content"] button')).find((button) => button.textContent.trim() === "取消").click()`);
  await window.webContents.executeJavaScript(`new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
  await window.webContents.executeJavaScript(`document.querySelector('[data-testid="quick-add-model"]').click()`);
  await waitForSelector(window, '[data-testid="notification-toast"]');
  const quickAddResult = await window.webContents.executeJavaScript(`(() => {
    const toast = document.querySelector('[data-testid="notification-toast"]');
    const viewport = document.querySelector('[data-testid="notification-viewport"]').getBoundingClientRect();
    return {
      message: toast.textContent,
      level: toast.dataset.level,
      rightInset: Math.round(window.innerWidth - viewport.right),
      topInset: Math.round(viewport.top),
      modelRows: document.querySelectorAll('[data-testid="model-row"]').length,
      discoveredRows: document.querySelectorAll('[data-testid="discovered-model-row"]').length,
    };
  })()`);
  assert.equal(createdModelRequest.modelType, "languageModel");
  assert.equal(createdModelRequest.modelId, "deepseek-v4-pro");
  assert.match(quickAddResult.message, /模型配置已保存/);
  assert.equal(quickAddResult.level, "success");
  assert.deepEqual(
    { rightInset: quickAddResult.rightInset, topInset: quickAddResult.topInset },
    { rightInset: 16, topInset: 16 },
  );
  assert.equal(quickAddResult.modelRows, 2);
  assert.equal(quickAddResult.discoveredRows, 0);
  const modelScreenshot = await capture(window, "model-settings.png");

  const themeMetrics = await window.webContents.executeJavaScript(`(() => {
    const root = getComputedStyle(document.documentElement);
    return {
      hasThemeAttribute: document.documentElement.hasAttribute("data-theme"),
      dark: document.documentElement.classList.contains("dark"),
      background: getComputedStyle(document.body).backgroundColor,
      radius: root.getPropertyValue("--radius").trim(),
    };
  })()`);
  assert.equal(themeMetrics.hasThemeAttribute, false);
  assert.equal(themeMetrics.dark, false);
  assert.equal(themeMetrics.background, "oklch(1 0 0)");
  assert.equal(Number.parseFloat(themeMetrics.radius), 0.625);

  await window.webContents.executeJavaScript(`document.querySelector('[data-testid="settings-back"]').click()`);
  await waitForSelector(window, '[data-testid="settings-launcher"]');

  emptyConfigMode = true;
  const emptyWindow = createTestWindow();
  await emptyWindow.loadFile(join(projectRoot, "out", "renderer", "index.html"));
  await waitForSelector(emptyWindow, '[data-slot="aui_thread-viewport"]');
  await emptyWindow.webContents.executeJavaScript(`document.querySelector('[data-testid="settings-launcher"]').click()`);
  await waitForSelector(emptyWindow, '[data-testid="settings-page"]');
  await emptyWindow.webContents.executeJavaScript(`document.querySelector('[data-testid="settings-tab-models"]').click()`);
  await emptyWindow.webContents.executeJavaScript(`new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
  await waitForSelector(emptyWindow, '[data-testid="provider-list"]');
  await waitForSelector(emptyWindow, '[data-testid="model-categories"]');

  const emptyLayout = await emptyWindow.webContents.executeJavaScript(`(() => {
    const nav = document.querySelector('[data-testid="settings-tab-models"]').getBoundingClientRect();
    const providerElement = document.querySelector('[data-testid="provider-list"]').closest('[data-slot="card"]');
    const modelElement = document.querySelector('[data-testid="model-categories"]').closest('[data-slot="card"]');
    const settingsContent = document.querySelector('[data-testid="settings-content"]');
    const provider = providerElement.getBoundingClientRect();
    const model = modelElement.getBoundingClientRect();
    return {
      providerRows: document.querySelectorAll('[data-testid="provider-row"]').length,
      categoryRows: document.querySelectorAll('[data-testid="model-categories"] [data-slot="tabs-trigger"]').length,
      modelRows: document.querySelectorAll('[data-testid="model-row"]').length,
      text: document.querySelector('main').textContent,
      leftMargin: Math.round(nav.left),
      rightMargin: Math.round(window.innerWidth - model.right),
      topMargin: Math.round(provider.top),
      bottomMargin: Math.round(window.innerHeight - provider.bottom),
      outerGap: Math.round(provider.left - nav.right),
      innerGap: Math.round(model.left - provider.right),
      providerHeight: Math.round(provider.height),
      modelHeight: Math.round(model.height),
      nestedInSettingsContent: settingsContent.contains(providerElement) && settingsContent.contains(modelElement),
    };
  })()`);
  assert.equal(emptyLayout.providerRows, 0);
  assert.equal(emptyLayout.categoryRows, 8);
  assert.equal(emptyLayout.modelRows, 0);
  assert.match(emptyLayout.text, /尚未添加供应商/);
  assert.doesNotMatch(emptyLayout.text, /AI Gateway/);
  assert.match(emptyLayout.text, /选择一个 Provider/);
  assert.equal(emptyLayout.nestedInSettingsContent, true);
  assert.equal(emptyLayout.leftMargin, emptyLayout.rightMargin);
  assert.equal(emptyLayout.topMargin, emptyLayout.bottomMargin);
  assert.equal(emptyLayout.outerGap, 40);
  assert.equal(emptyLayout.innerGap, 24);
  assert.equal(emptyLayout.providerHeight, emptyLayout.modelHeight);
  const emptyScreenshot = await capture(emptyWindow, "empty-model-settings.png");
  await emptyWindow.webContents.executeJavaScript(`document.querySelector('[data-testid="add-provider"]').click()`);
  await waitForSelector(emptyWindow, "#provider-type");
  const createProviderDialog = await emptyWindow.webContents.executeJavaScript(`(() => {
    const fields = ["#provider-type", "#provider-name", "#provider-url", "#provider-secret"].map((selector) => document.querySelector(selector).getBoundingClientRect());
    return {
      selectedType: document.querySelector('#provider-type').value,
      usesDialog: document.querySelector('#provider-type').closest('[data-slot="dialog-content"]') !== null,
      hasEnabledOption: document.querySelector('#provider-enabled') !== null,
      fieldsAreVertical: fields.every((rect, index) => index === 0 || fields[index - 1].bottom <= rect.top),
      required: ["#provider-type", "#provider-name", "#provider-url", "#provider-secret"].map((selector) => document.querySelector(selector).required),
      text: document.querySelector('#provider-type').closest('[data-slot="dialog-content"]').innerText,
    };
  })()`);
  assert.equal(createProviderDialog.selectedType, "deepseek");
  assert.equal(createProviderDialog.usesDialog, true);
  assert.equal(createProviderDialog.hasEnabledOption, false);
  assert.equal(createProviderDialog.fieldsAreVertical, true);
  assert.deepEqual(createProviderDialog.required, [true, true, false, true]);
  assert.match(createProviderDialog.text, /添加供应商[\s\S]*类型[\s\S]*名称[\s\S]*Base URL[\s\S]*API Key[\s\S]*创建/);
  assert.doesNotMatch(createProviderDialog.text, /连接一个|官方 Provider|可选|可稍后|Electron main process|SQLite|创建 Provider/);
  const endpointPlaceholders = await emptyWindow.webContents.executeJavaScript(`(async () => {
    const select = document.querySelector('#provider-type');
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
    const result = {};
    for (const type of Array.from(select.options, (option) => option.value)) {
      setter.call(select, type);
      select.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      result[type] = document.querySelector('#provider-url').placeholder;
    }
    return result;
  })()`);
  assert.deepEqual(endpointPlaceholders, {
    gateway: "https://ai-gateway.vercel.sh/v4/ai",
    "openai-compatible": "https://api.example.com/v1",
    openai: "https://api.openai.com/v1",
    anthropic: "https://api.anthropic.com/v1",
    google: "https://generativelanguage.googleapis.com/v1beta",
    deepseek: "https://api.deepseek.com",
    xai: "https://api.x.ai/v1",
    moonshotai: "https://api.moonshot.ai/v1",
    alibaba: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
  });
  await emptyWindow.webContents.executeJavaScript(`(() => {
    const select = document.querySelector('#provider-type');
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, 'deepseek');
    select.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  const providerDialogScreenshot = await capture(emptyWindow, "new-provider-dialog.png");
  await emptyWindow.webContents.executeJavaScript(`(() => {
    const input = document.querySelector('#provider-secret');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'test-api-key');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.closest('form').requestSubmit();
  })()`);
  await waitForSelector(emptyWindow, '[data-testid="provider-row"]');
  assert.equal(createdProviderRequest.enabled, true);
  assert.equal(replacedCredentialRequest.secret, "test-api-key");
  const createdProviderRows = await emptyWindow.webContents.executeJavaScript(`document.querySelectorAll('[data-testid="provider-row"]').length`);
  assert.equal(createdProviderRows, 1);
  await hoverSelector(emptyWindow, '[data-testid="provider-row"]');
  await emptyWindow.webContents.executeJavaScript(`document.querySelector('[data-testid="delete-provider"]').click()`);
  await waitForSelector(emptyWindow, '[data-testid="confirm-dialog"]');
  const deleteProviderDialogText = await emptyWindow.webContents.executeJavaScript(`document.querySelector('[data-testid="confirm-dialog"]').innerText`);
  assert.match(deleteProviderDialogText, /删除供应商[\s\S]*及其全部模型配置[\s\S]*取消[\s\S]*删除供应商/);
  await emptyWindow.webContents.executeJavaScript(`document.querySelector('[data-testid="confirm-dialog-confirm"]').click()`);
  await emptyWindow.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const deadline = Date.now() + 5000;
    const check = () => {
      if (document.querySelectorAll('[data-testid="provider-row"]').length === 0) return resolve(true);
      if (Date.now() > deadline) return reject(new Error('Timed out waiting for provider deletion'));
      setTimeout(check, 25);
    };
    check();
  })`);
  emptyWindow.destroy();
  window.destroy();

  console.log(JSON.stringify({ starlineScreenshot, darkStarlineScreenshot, characterScreenshot, modelScreenshot, emptyScreenshot, providerDialogScreenshot, hoverScreenshot }));
}

console.log("UI smoke: waiting for Electron");
void app.whenReady()
  .then(run)
  .catch((error) => {
    exitCode = 1;
    console.error(error);
  })
  .finally(() => {
    app.exit(exitCode);
  });
