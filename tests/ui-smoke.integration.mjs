import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { app, BrowserWindow, ipcMain } from "electron";

const projectRoot = process.cwd();
const userDataPath = join(projectRoot, ".test-dist", "ui-user-data");
const screenshotDirectory = mkdtempSync(join(tmpdir(), "katarune-ui-screenshots-"));

mkdirSync(userDataPath, { recursive: true });
app.setPath("userData", userDataPath);
app.commandLine.appendSwitch("disable-gpu");

const now = new Date("2026-07-19T00:00:00.000Z");
const providerId = "d3867f4b-e85f-4ff4-ac2b-974dc39ad832";
const modelId = "e76076e7-73a8-42c2-92d7-f9fa8d44f5eb";
let emptyConfigMode = false;
let createdProviderRequest = null;
let createdProvider = null;
let replacedCredentialRequest = null;
let updatedModelRequest = null;
let modelEnabled = true;

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
  ipcMain.handle("threads:list", () => ({ threads: [] }));
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
    ],
  }));
  ipcMain.handle("model-configs:discover", () => ({
    models: [
      { id: "deepseek-chat", displayName: "DeepSeek Chat", owner: "deepseek", description: null, modelType: "languageModel" },
      { id: "deepseek-v4-pro", displayName: "DeepSeek V4 Pro", owner: "deepseek", description: "Reasoning model", modelType: "languageModel" },
    ],
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
  const launcherMetrics = await window.webContents.executeJavaScript(`(() => {
    const launcherElement = document.querySelector('[data-testid="settings-launcher"]');
    const launcher = launcherElement.getBoundingClientRect();
    return {
      left: Math.round(launcher.left),
      bottom: Math.round(window.innerHeight - launcher.bottom),
      width: Math.round(launcher.width),
      height: Math.round(launcher.height),
      isRound: Number.parseFloat(getComputedStyle(launcherElement).borderRadius) * 2 >= Math.min(launcher.width, launcher.height),
    };
  })()`);
  assert.deepEqual(launcherMetrics, { left: 16, bottom: 16, width: 32, height: 32, isRound: true });
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
    const back = document.querySelector('[data-testid="settings-back"]').getBoundingClientRect();
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
      backBottom: Math.round(window.innerHeight - back.bottom),
      backWidth: Math.round(back.width),
      backHeight: Math.round(back.height),
      backIsRound: Number.parseFloat(getComputedStyle(document.querySelector('[data-testid="settings-back"]')).borderRadius) * 2 >= Math.min(back.width, back.height),
    };
  })()`);
  assert.equal(settingsLayout.hasExternalLauncher, false);
  assert.equal(settingsLayout.hasPageHeader, false);
  assert.deepEqual(
    { left: settingsLayout.left, top: settingsLayout.top, width: settingsLayout.width, height: settingsLayout.height },
    { left: 0, top: 0, width: settingsLayout.viewportWidth, height: settingsLayout.viewportHeight },
  );
  assert.equal(settingsLayout.pageOverflow, "hidden");
  assert.equal(settingsLayout.backLeft, 16);
  assert.equal(settingsLayout.backBottom, 16);
  assert.equal(settingsLayout.backWidth, launcherMetrics.width);
  assert.equal(settingsLayout.backHeight, launcherMetrics.height);
  assert.equal(settingsLayout.backIsRound, true);

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
      backBottom: Math.round(window.innerHeight - back.bottom),
      tabsInline: Math.round(generalTab.top) === Math.round(modelTab.top) && generalTab.right <= modelTab.left,
      panelsStacked: provider.bottom <= model.top,
      contentLeft: Math.round(provider.left),
      contentRight: Math.round(workspace.right - provider.right),
    };
  })()`);
  assert.equal(compactLayout.pageWidth, compactLayout.viewportWidth);
  assert.equal(compactLayout.documentScrollWidth, compactLayout.viewportWidth);
  assert.equal(compactLayout.backLeft, 16);
  assert.equal(compactLayout.backBottom, 16);
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
  assert.deepEqual(modelActions, { opacity: "1", labels: ["测试连接（可能产生费用）", "编辑模型", "删除模型"], deleteUsesNormalColor: true, textUsesForeground: true });
  await clickSelector(window, '[data-testid="model-row"] [data-slot="switch"]');
  await window.webContents.executeJavaScript(`new Promise((resolve) => setTimeout(resolve, 100))`);
  assert.equal(updatedModelRequest.enabled, false);
  const modelSwitchUnchecked = await window.webContents.executeJavaScript(`document.querySelector('[data-testid="model-row"] [data-slot="switch"]').hasAttribute('data-unchecked')`);
  assert.equal(modelSwitchUnchecked, true);
  await hoverSelector(window, '[data-testid="model-search"]');
  await window.webContents.executeJavaScript(`new Promise((resolve) => setTimeout(resolve, 200))`);
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
  await window.webContents.executeJavaScript(`new Promise((resolve) => setTimeout(resolve, 200))`);
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
  await waitForSelector(window, '[data-testid="discovered-model-row"]');
  const discoveredCount = await window.webContents.executeJavaScript(`document.querySelectorAll('[data-testid="discovered-model-row"]').length`);
  assert.equal(discoveredCount, 1);
  const categoryColumns = await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[data-testid="model-type-icon"]'), (element) => Math.round(element.getBoundingClientRect().left))`);
  assert.equal(new Set(categoryColumns).size, 1);
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
  const addModelDialogText = await window.webContents.executeJavaScript(`document.querySelector('#model-type').closest('[data-slot="dialog-content"]').innerText`);
  assert.match(addModelDialogText, /添加模型[\s\S]*模型类别[\s\S]*厂商模型 ID[\s\S]*显示名称/);
  assert.doesNotMatch(addModelDialogText, /启用模型/);
  await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[data-slot="dialog-content"] button')).find((button) => button.textContent.trim() === "取消").click()`);
  await window.webContents.executeJavaScript(`new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
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

  console.log(JSON.stringify({ modelScreenshot, emptyScreenshot, providerDialogScreenshot, hoverScreenshot }));
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
