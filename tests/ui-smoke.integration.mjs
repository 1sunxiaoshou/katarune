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
    providerConfigs: [
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
  ipcMain.handle("model-configs:list", () => ({
    modelConfigs: [
      {
        id: modelId,
        providerConfigId: providerId,
        modelType: "languageModel",
        modelId: "deepseek-chat",
        displayName: "DeepSeek Chat",
        settings: null,
        enabled: true,
        createdAt: now,
        updatedAt: now,
      },
    ],
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

let exitCode = 0;

async function run() {
  console.log("UI smoke: registering IPC mocks");
  registerMockHandlers();

  const window = new BrowserWindow({
    width: 1280,
    height: 900,
    show: false,
    backgroundColor: "#10131e",
    webPreferences: {
      preload: join(projectRoot, "out", "preload", "index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

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
      radius: getComputedStyle(launcherElement).borderRadius,
    };
  })()`);
  assert.deepEqual(launcherMetrics, { left: 16, bottom: 16, width: 24, height: 24, radius: "10px" });
  console.log("UI smoke: opening settings");
  await window.webContents.executeJavaScript(`document.querySelector('[data-testid="settings-launcher"]').click()`);
  await waitForSelector(window, '[data-testid="model-row"]');

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
      backRadius: getComputedStyle(document.querySelector('[data-testid="settings-back"]')).borderRadius,
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
  assert.equal(settingsLayout.backRadius, launcherMetrics.radius);

  window.setSize(375, 700);
  await window.webContents.executeJavaScript(`new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
  const compactLayout = await window.webContents.executeJavaScript(`(() => {
    const page = document.querySelector('[data-testid="settings-page"]');
    const back = document.querySelector('[data-testid="settings-back"]').getBoundingClientRect();
    return {
      pageWidth: Math.round(page.getBoundingClientRect().width),
      viewportWidth: window.innerWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      backLeft: Math.round(back.left),
      backBottom: Math.round(window.innerHeight - back.bottom),
    };
  })()`);
  assert.equal(compactLayout.pageWidth, compactLayout.viewportWidth);
  assert.equal(compactLayout.documentScrollWidth, compactLayout.viewportWidth);
  assert.equal(compactLayout.backLeft, 16);
  assert.equal(compactLayout.backBottom, 16);
  window.setSize(1280, 900);
  await window.webContents.executeJavaScript(`new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);

  const settingsText = await window.webContents.executeJavaScript(`document.querySelector("main").textContent`);
  assert.match(settingsText, /安全凭据/);
  assert.match(settingsText, /DeepSeek Chat/);
  assert.doesNotMatch(settingsText, /Registry ID/);
  assert.match(settingsText, /语言模型/);

  await window.webContents.executeJavaScript(`document.querySelector('[data-testid="model-row"] button').click()`);
  await waitForSelector(window, "#model-type");
  const modelTypeOptions = await window.webContents.executeJavaScript(`(() => {
    const select = document.querySelector("#model-type");
    return {
      value: select.value,
      options: Array.from(select.options, (option) => option.value),
    };
  })()`);
  assert.equal(modelTypeOptions.value, "languageModel");
  assert.deepEqual(modelTypeOptions.options, [
    "languageModel",
    "embeddingModel",
    "imageModel",
    "transcriptionModel",
    "speechModel",
    "rerankingModel",
    "videoModel",
  ]);
  const modelScreenshot = await capture(window, "model-settings.png");

  await window.webContents.executeJavaScript(`document.querySelector('[data-testid="appearance-tab"]').click()`);
  await waitForSelector(window, '[data-testid="theme-plana"]');
  await window.webContents.executeJavaScript(`document.querySelector('[data-testid="theme-plana"]').click()`);

  const planaMetrics = await window.webContents.executeJavaScript(`(() => {
    const root = getComputedStyle(document.documentElement);
    return {
      theme: document.documentElement.dataset.theme,
      background: root.getPropertyValue("--background").trim(),
      radius: root.getPropertyValue("--radius").trim(),
    };
  })()`);
  assert.equal(planaMetrics.theme, "plana");
  assert.equal(Number.parseFloat(planaMetrics.radius), 0.625);
  const planaScreenshot = await capture(window, "plana-settings.png");

  await window.webContents.executeJavaScript(`document.querySelector('[data-testid="theme-arona"]').click()`);
  const aronaMetrics = await window.webContents.executeJavaScript(`(() => {
    const root = getComputedStyle(document.documentElement);
    return {
      theme: document.documentElement.dataset.theme,
      background: root.getPropertyValue("--background").trim(),
      radius: root.getPropertyValue("--radius").trim(),
    };
  })()`);
  assert.equal(aronaMetrics.theme, "arona");
  assert.notEqual(aronaMetrics.background, planaMetrics.background);
  assert.equal(aronaMetrics.radius, planaMetrics.radius);
  const aronaScreenshot = await capture(window, "arona-settings.png");

  await window.webContents.executeJavaScript(`document.querySelector('[data-testid="settings-back"]').click()`);
  await waitForSelector(window, '[data-testid="settings-launcher"]');

  window.destroy();
  console.log(JSON.stringify({ modelScreenshot, planaScreenshot, aronaScreenshot }));
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
