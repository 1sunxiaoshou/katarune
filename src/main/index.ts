import { AvatarService } from "./avatar/avatarService";
import { join } from "node:path";
import { app, BrowserWindow, Menu, safeStorage, shell } from "electron";
import { createAiRuntime, type AiRuntime } from "./ai/runtime";
import {
  validateModelMetadata,
  validateModelSettings,
  validateProviderSettings,
} from "./ai/providerDefinitions";
import { kataruneAiToolkit } from "./ai/toolkit";
import { registerAssetProtocol, registerAssetScheme } from "./assets/assetProtocol";
import { createAssetService } from "./assets/assetService";
import { loadDefaultCharacterConfig } from "./characters/defaultCharacter";
import { openDatabase, type DatabaseRuntime } from "./database/database";
import { registerIpcHandlers } from "./ipc/registerIpcHandlers";
import {
  createMemoryWikiService,
  type MemoryWikiService,
} from "./memory/memoryWikiService";
import { createCredentialStore } from "./security/credentialStore";
import { SpeechRequestRegistry } from "./speech/speechRequestRegistry";
import { createTtsCache } from "./speech/ttsCache";
import { createSpeechService } from "./speech/ttsService";
import { createSpeechArtifactCache } from "./speech/speechArtifactCache";
import { createSpeechTemporaryDirectory } from "./speech/speechTemporaryDirectory";

let avatarService: AvatarService | undefined;

if (!app.isPackaged) {
  app.setPath("userData", `${app.getPath("userData")}-development`);
}

registerAssetScheme();

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1080,
    height: 720,
    minWidth: 760,
    minHeight: 520,
    show: false,
    icon: app.isPackaged
      ? join(__dirname, "../renderer/katarune-logo.png")
      : join(app.getAppPath(), "resources", "katarune-logo.png"),
    backgroundColor: "#10131a",
    webPreferences: {
      preload: join(__dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.once("ready-to-show", () => {
    window.show();
    // Windows can inherit SW_HIDE from the launching terminal on the first show.
    if (!window.isVisible()) window.show();
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) {
      void shell.openExternal(url);
    }

    return { action: "deny" };
  });

  window.webContents.on("will-navigate", (event) => {
    event.preventDefault();
  });

  const rendererUrl = process.env.ELECTRON_RENDERER_URL;
  if (rendererUrl !== undefined) {
    void window.loadURL(rendererUrl);
  } else {
    void window.loadFile(join(__dirname, "../renderer/index.html"));
  }

  return window;
}

let databaseRuntime: DatabaseRuntime | undefined;
let aiRuntime: AiRuntime | undefined;
let speechRequests: SpeechRequestRegistry | undefined;
let memoryWiki: MemoryWikiService | undefined;

void app.whenReady().then(async () => {
  const characterResourcesPath = app.isPackaged
    ? join(process.resourcesPath, "characters")
    : join(app.getAppPath(), "resources", "characters");
  const defaultCharacterConfig = loadDefaultCharacterConfig(characterResourcesPath);
  const assetService = createAssetService({
    userDataPath: app.getPath("userData"),
    characterResourcesPath,
  });
  databaseRuntime = openDatabase({
    userDataPath: app.getPath("userData"),
    appPath: app.getAppPath(),
    characterResourcesPath,
    configValidator: {
      validateModelMetadata,
      validateModelSettings,
      validateProviderSettings,
    },
  });
  assetService.reconcile(databaseRuntime, defaultCharacterConfig);
  assetService.cleanupUnreferencedChatAttachments(databaseRuntime);
  memoryWiki = createMemoryWikiService({ userDataPath: app.getPath("userData") });
  await memoryWiki.initialize(
    databaseRuntime.listCharacters().characters.map((character) => character.id),
  );
  return Promise.all([
    createCredentialStore({
      userDataPath: app.getPath("userData"),
      cipher: {
        isEncryptionAvailable: () => safeStorage.isAsyncEncryptionAvailable(),
        encryptString: (value) => safeStorage.encryptStringAsync(value),
        decryptString: (value) => safeStorage.decryptStringAsync(value),
      },
    }),
    Promise.resolve(assetService),
  ]);
}).then(async ([credentialStore, assetService]) => {
  if (databaseRuntime === undefined || memoryWiki === undefined) {
    throw new Error("Database or Memory Wiki runtime was not initialized.");
  }
  Menu.setApplicationMenu(null);
  aiRuntime = await createAiRuntime({ database: databaseRuntime, credentialStore });
  let ttsCache = createTtsCache({
    directory: join(app.getPath("userData"), "tts-cache"),
  });
  try {
    await ttsCache.initialize();
  } catch (error) {
    console.error("Failed to initialize the optional TTS cache.", error);
    ttsCache = {
      initialize: async () => undefined,
      get: async () => null,
      put: async () => undefined,
    };
  }
  const speechService = createSpeechService({
    artifactCache: createSpeechArtifactCache(join(app.getPath("userData"), "tts-cache")),
    profileDirectory: join(app.getPath("userData"), "speech-profiles"),
    database: databaseRuntime,
    aiRuntime,
    cache: ttsCache,
  });
  registerAssetProtocol(databaseRuntime, assetService);
  avatarService = new AvatarService(
    app.isPackaged ? join(process.resourcesPath, "avatar", "KataruneAvatar.exe")
      : join(app.getAppPath(), "unity", "KataruneAvatar", "Builds", "Windows", "KataruneAvatar.exe"),
    join(app.getPath("userData"), "logs"),
  );
  avatarService.configureSpeech(speechService,
    await createSpeechTemporaryDirectory(join(app.getPath("userData"), "speech-playback")));
  speechRequests = registerIpcHandlers(
    databaseRuntime,
    aiRuntime,
    credentialStore,
    assetService,
    speechService,
    memoryWiki,
    avatarService,
  );
  createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
}).catch((error: unknown) => {
  console.error("Failed to initialize Katarune.", error);
  app.quit();
});

app.on("before-quit", () => {
  avatarService?.stop();
  speechRequests?.cancelAll();
  speechRequests = undefined;
  void kataruneAiToolkit.close().catch((error: unknown) => {
    console.error("Failed to close the AI toolkit.", error);
  });
  databaseRuntime?.close();
  databaseRuntime = undefined;
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
