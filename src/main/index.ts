import { join } from "node:path";
import { app, BrowserWindow, dialog, ipcMain, Menu, safeStorage, shell } from "electron";
import {
  appendThreadMessageRequestSchema,
  appInfoSchema,
  appStateSchema,
  characterIdRequestSchema,
  characterPortraitImportRequestSchema,
  characterPortraitImportResultSchema,
  chatStreamRequestSchema,
  chatStreamResponseFrameSchema,
  createCharacterRequestSchema,
  createModelConfigRequestSchema,
  createProviderConfigRequestSchema,
  deleteCharacterResultSchema,
  deleteThreadMessagesRequestSchema,
  IPC_CHANNELS,
  modelConfigIdRequestSchema,
  discoveredModelListSchema,
  generateThreadTitleRequestSchema,
  generateThreadTitleResponseSchema,
  operationSuccessSchema,
  providerConfigIdRequestSchema,
  replaceProviderCredentialRequestSchema,
  renameThreadRequestSchema,
  setThreadStatusRequestSchema,
  setActiveCharacterRequestSchema,
  listThreadsRequestSchema,
  threadIdRequestSchema,
  updateProviderConfigRequestSchema,
  updateModelConfigRequestSchema,
  updateCharacterRequestSchema,
  type AppInfo,
} from "../shared/ipc";
import { createAiRuntime, type AiRuntime } from "./ai/runtime";
import { createChatService } from "./ai/chatService";
import { ChatStreamRegistry, startChatStream } from "./ai/chatStream";
import { discoverProviderModels } from "./ai/modelDiscovery";
import { registerAssetProtocol, registerAssetScheme } from "./assets/assetProtocol";
import { createAssetService, type AssetService } from "./assets/assetService";
import { loadDefaultCharacterConfig } from "./characters/defaultCharacter";
import { openDatabase, type DatabaseRuntime } from "./database/database";
import { createCredentialStore, type CredentialStore } from "./security/credentialStore";

if (!app.isPackaged) {
  app.setPath("userData", `${app.getPath("userData")}-development`);
}

registerAssetScheme();

function getAppInfo(): AppInfo {
  return appInfoSchema.parse({
    name: app.getName(),
    version: app.getVersion(),
    platform: process.platform,
    electronVersion: process.versions.electron,
    nodeVersion: process.versions.node,
  });
}

function registerIpcHandlers(
  database: DatabaseRuntime,
  aiRuntime: AiRuntime,
  credentialStore: CredentialStore,
  assetService: AssetService,
): void {
  const chatService = createChatService({ database, aiRuntime });
  const chatStreams = new ChatStreamRegistry();

  ipcMain.handle(IPC_CHANNELS.getAppInfo, getAppInfo);
  ipcMain.handle(IPC_CHANNELS.getDatabaseStatus, () => database.getStatus());
  ipcMain.handle(IPC_CHANNELS.getAiRuntimeStatus, () => aiRuntime.getStatus());
  ipcMain.handle(IPC_CHANNELS.getAppState, () => appStateSchema.parse(database.getAppState()));
  ipcMain.handle(IPC_CHANNELS.setActiveCharacter, (_event, value: unknown) => {
    const { characterId } = setActiveCharacterRequestSchema.parse(value);
    return appStateSchema.parse(database.setActiveCharacter(characterId));
  });
  ipcMain.handle(IPC_CHANNELS.listThreads, (_event, value: unknown) => {
    const { characterId } = listThreadsRequestSchema.parse(value);
    return database.listThreads(characterId);
  });
  ipcMain.handle(IPC_CHANNELS.initializeThread, (_event, value: unknown) => {
    const { threadId, characterId } = threadIdRequestSchema.parse(value);
    return database.initializeThread(threadId, characterId);
  });
  ipcMain.handle(IPC_CHANNELS.fetchThread, (_event, value: unknown) => {
    const { threadId, characterId } = threadIdRequestSchema.parse(value);
    return database.fetchThread(threadId, characterId);
  });
  ipcMain.handle(IPC_CHANNELS.generateThreadTitle, async (_event, value: unknown) => {
    const request = generateThreadTitleRequestSchema.parse(value);
    return generateThreadTitleResponseSchema.parse(
      await chatService.generateTitle(request),
    );
  });
  ipcMain.handle(IPC_CHANNELS.renameThread, (_event, value: unknown) => {
    const { threadId, characterId, title } = renameThreadRequestSchema.parse(value);
    database.renameThread(threadId, characterId, title);
    return operationSuccessSchema.parse({ success: true });
  });
  ipcMain.handle(IPC_CHANNELS.setThreadStatus, (_event, value: unknown) => {
    const { threadId, characterId, status } = setThreadStatusRequestSchema.parse(value);
    database.setThreadStatus(threadId, characterId, status);
    return operationSuccessSchema.parse({ success: true });
  });
  ipcMain.handle(IPC_CHANNELS.deleteThread, (_event, value: unknown) => {
    const { threadId, characterId } = threadIdRequestSchema.parse(value);
    chatStreams.cancelThread(characterId, threadId);
    database.deleteThread(threadId, characterId);
    return operationSuccessSchema.parse({ success: true });
  });
  ipcMain.handle(IPC_CHANNELS.loadThreadMessages, (_event, value: unknown) => {
    const { threadId, characterId } = threadIdRequestSchema.parse(value);
    return database.loadThreadMessages(threadId, characterId);
  });
  ipcMain.handle(IPC_CHANNELS.appendThreadMessage, (_event, value: unknown) => {
    const request = appendThreadMessageRequestSchema.parse(value);
    database.appendThreadMessage(request);
    return operationSuccessSchema.parse({ success: true });
  });
  ipcMain.handle(IPC_CHANNELS.deleteThreadMessages, (_event, value: unknown) => {
    const { threadId, characterId, messageIds } = deleteThreadMessagesRequestSchema.parse(value);
    database.deleteThreadMessages(threadId, characterId, messageIds);
    return operationSuccessSchema.parse({ success: true });
  });
  ipcMain.on(IPC_CHANNELS.startChatStream, (event, value: unknown) => {
    const port = event.ports[0];
    if (port === undefined) return;

    const request = chatStreamRequestSchema.safeParse(value);
    if (!request.success) {
      port.start();
      port.postMessage(
        chatStreamResponseFrameSchema.parse({
          type: "error",
          message: "聊天请求无效。",
        }),
      );
      port.close();
      return;
    }

    const senderId = event.sender.id;
    let unregisterStream = (): void => undefined;
    let streamClosed = false;
    const handleSenderDestroyed = (): void => chatStreams.cancelSender(senderId);
    const closeStream = startChatStream({
      chatService,
      request: request.data,
      port,
      onClose: () => {
        streamClosed = true;
        unregisterStream();
        event.sender.removeListener("destroyed", handleSenderDestroyed);
      },
    });
    if (!streamClosed) {
      unregisterStream = chatStreams.register({
        senderId,
        requestId: request.data.requestId,
        characterId: request.data.characterId,
        threadId: request.data.threadId,
        close: closeStream,
      });
      event.sender.once("destroyed", handleSenderDestroyed);
    }
  });
  ipcMain.handle(IPC_CHANNELS.listProviderConfigs, () => database.listProviderConfigs());
  ipcMain.handle(IPC_CHANNELS.createProviderConfig, async (_event, value: unknown) => {
    const request = createProviderConfigRequestSchema.parse(value);
    const result = database.createProviderConfig(request);
    await aiRuntime.reload();
    return result;
  });
  ipcMain.handle(IPC_CHANNELS.fetchProviderConfig, (_event, value: unknown) => {
    const { id } = providerConfigIdRequestSchema.parse(value);
    return database.fetchProviderConfig(id);
  });
  ipcMain.handle(IPC_CHANNELS.updateProviderConfig, async (_event, value: unknown) => {
    const request = updateProviderConfigRequestSchema.parse(value);
    const result = database.updateProviderConfig(request);
    await aiRuntime.reload();
    return result;
  });
  ipcMain.handle(IPC_CHANNELS.replaceProviderCredential, async (_event, value: unknown) => {
    const { providerConfigId, secret } = replaceProviderCredentialRequestSchema.parse(value);
    const previousConfig = database.fetchProviderConfig(providerConfigId);
    const nextReference = await credentialStore.put(secret);

    try {
      const result = database.setProviderCredentialReference(providerConfigId, nextReference);
      await aiRuntime.reload();

      if (previousConfig.credentialRef !== null) {
        try {
          await credentialStore.delete(previousConfig.credentialRef);
        } catch (error) {
          database.setProviderCredentialReference(providerConfigId, previousConfig.credentialRef);
          await aiRuntime.reload();
          await credentialStore.delete(nextReference);
          throw error;
        }
      }

      return result;
    } catch (error) {
      if (database.fetchProviderConfig(providerConfigId).credentialRef === nextReference) {
        database.setProviderCredentialReference(providerConfigId, previousConfig.credentialRef);
        await aiRuntime.reload();
      }
      await credentialStore.delete(nextReference);
      throw error;
    }
  });
  ipcMain.handle(IPC_CHANNELS.clearProviderCredential, async (_event, value: unknown) => {
    const { id } = providerConfigIdRequestSchema.parse(value);
    const previousConfig = database.fetchProviderConfig(id);
    if (previousConfig.credentialRef === null) return previousConfig;

    const result = database.setProviderCredentialReference(id, null);
    try {
      await aiRuntime.reload();
      await credentialStore.delete(previousConfig.credentialRef);
      return result;
    } catch (error) {
      database.setProviderCredentialReference(id, previousConfig.credentialRef);
      await aiRuntime.reload();
      throw error;
    }
  });
  ipcMain.handle(IPC_CHANNELS.deleteProviderConfig, async (_event, value: unknown) => {
    const { id } = providerConfigIdRequestSchema.parse(value);
    const credentialRef = database.fetchProviderConfig(id).credentialRef;
    database.deleteProviderConfig(id);
    await aiRuntime.reload();
    if (credentialRef !== null) await credentialStore.delete(credentialRef);
    return operationSuccessSchema.parse({ success: true });
  });
  ipcMain.handle(IPC_CHANNELS.listModelConfigs, () => database.listModelConfigs());
  ipcMain.handle(IPC_CHANNELS.createModelConfig, async (_event, value: unknown) => {
    const request = createModelConfigRequestSchema.parse(value);
    const result = database.createModelConfig(request);
    await aiRuntime.reload();
    return result;
  });
  ipcMain.handle(IPC_CHANNELS.fetchModelConfig, (_event, value: unknown) => {
    const { id } = modelConfigIdRequestSchema.parse(value);
    return database.fetchModelConfig(id);
  });
  ipcMain.handle(IPC_CHANNELS.updateModelConfig, async (_event, value: unknown) => {
    const request = updateModelConfigRequestSchema.parse(value);
    const result = database.updateModelConfig(request);
    await aiRuntime.reload();
    return result;
  });
  ipcMain.handle(IPC_CHANNELS.deleteModelConfig, async (_event, value: unknown) => {
    const { id } = modelConfigIdRequestSchema.parse(value);
    database.deleteModelConfig(id);
    await aiRuntime.reload();
    return operationSuccessSchema.parse({ success: true });
  });
  ipcMain.handle(IPC_CHANNELS.discoverProviderModels, async (_event, value: unknown) => {
    const { id } = providerConfigIdRequestSchema.parse(value);
    const provider = database.fetchProviderConfig(id);
    const apiKey = provider.credentialRef === null
      ? undefined
      : await credentialStore.resolve(provider.credentialRef);
    return discoveredModelListSchema.parse(await discoverProviderModels(provider, apiKey));
  });
  ipcMain.handle(IPC_CHANNELS.testModelConnection, (_event, value: unknown) => {
    const { id } = modelConfigIdRequestSchema.parse(value);
    return aiRuntime.testConnection(id);
  });
  ipcMain.handle(IPC_CHANNELS.listCharacters, () => database.listCharacters());
  ipcMain.handle(IPC_CHANNELS.createCharacter, (_event, value: unknown) =>
    database.createCharacter(createCharacterRequestSchema.parse(value)),
  );
  ipcMain.handle(IPC_CHANNELS.deleteCharacter, (_event, value: unknown) => {
    const { id } = characterIdRequestSchema.parse(value);
    chatStreams.cancelCharacter(id);
    return deleteCharacterResultSchema.parse(database.deleteCharacter(id));
  });
  ipcMain.handle(IPC_CHANNELS.updateCharacter, (_event, value: unknown) => {
    return database.updateCharacter(updateCharacterRequestSchema.parse(value));
  });
  ipcMain.handle(IPC_CHANNELS.importCharacterPortrait, async (event, value: unknown) => {
    const request = characterPortraitImportRequestSchema.parse(value);
    if (request.mode === "existing") database.fetchCharacter(request.id);
    const owner = BrowserWindow.fromWebContents(event.sender);
    const selection =
      owner === null
        ? await dialog.showOpenDialog({
            properties: ["openFile"],
            filters: [{ name: "角色立绘", extensions: ["png", "jpg", "jpeg", "webp"] }],
          })
        : await dialog.showOpenDialog(owner, {
            properties: ["openFile"],
            filters: [{ name: "角色立绘", extensions: ["png", "jpg", "jpeg", "webp"] }],
          });

    if (selection.canceled || selection.filePaths[0] === undefined) {
      return characterPortraitImportResultSchema.parse({ canceled: true, character: null });
    }

    const registration = assetService.importPortrait(selection.filePaths[0]);
    let updated;
    try {
      updated =
        request.mode === "existing"
          ? database.registerAssetAndSetCharacterPortrait(request.id, registration)
          : database.createCharacter(request.character, registration);
    } catch (error) {
      assetService.removeExact(registration.id);
      throw error;
    }
    return characterPortraitImportResultSchema.parse({ canceled: false, character: updated });
  });
}

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1080,
    height: 720,
    minWidth: 760,
    minHeight: 520,
    show: false,
    icon: join(__dirname, "../renderer/logo.png"),
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

void app.whenReady().then(() => {
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
  });
  assetService.reconcile(databaseRuntime, defaultCharacterConfig);
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
  if (databaseRuntime === undefined) {
    throw new Error("Database runtime was not initialized.");
  }
  Menu.setApplicationMenu(null);
  aiRuntime = await createAiRuntime({ database: databaseRuntime, credentialStore });
  registerAssetProtocol(databaseRuntime, assetService);
  registerIpcHandlers(databaseRuntime, aiRuntime, credentialStore, assetService);
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
  databaseRuntime?.close();
  databaseRuntime = undefined;
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
