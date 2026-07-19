import { join } from "node:path";
import { app, BrowserWindow, ipcMain, Menu, safeStorage, shell } from "electron";
import {
  appendThreadMessageRequestSchema,
  appInfoSchema,
  createModelConfigRequestSchema,
  createProviderConfigRequestSchema,
  deleteThreadMessagesRequestSchema,
  IPC_CHANNELS,
  modelConfigIdRequestSchema,
  operationSuccessSchema,
  providerConfigIdRequestSchema,
  replaceProviderCredentialRequestSchema,
  renameThreadRequestSchema,
  setThreadStatusRequestSchema,
  threadIdRequestSchema,
  updateProviderConfigRequestSchema,
  updateModelConfigRequestSchema,
  type AppInfo,
} from "../shared/ipc";
import { createAiRuntime, type AiRuntime } from "./ai/runtime";
import { openDatabase, type DatabaseRuntime } from "./database/database";
import { createCredentialStore, type CredentialStore } from "./security/credentialStore";

if (!app.isPackaged) {
  app.setPath("userData", `${app.getPath("userData")}-development`);
}

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
): void {
  ipcMain.handle(IPC_CHANNELS.getAppInfo, getAppInfo);
  ipcMain.handle(IPC_CHANNELS.getDatabaseStatus, () => database.getStatus());
  ipcMain.handle(IPC_CHANNELS.getAiRuntimeStatus, () => aiRuntime.getStatus());
  ipcMain.handle(IPC_CHANNELS.listThreads, () => database.listThreads());
  ipcMain.handle(IPC_CHANNELS.initializeThread, (_event, value: unknown) => {
    const { threadId } = threadIdRequestSchema.parse(value);
    return database.initializeThread(threadId);
  });
  ipcMain.handle(IPC_CHANNELS.fetchThread, (_event, value: unknown) => {
    const { threadId } = threadIdRequestSchema.parse(value);
    return database.fetchThread(threadId);
  });
  ipcMain.handle(IPC_CHANNELS.renameThread, (_event, value: unknown) => {
    const { threadId, title } = renameThreadRequestSchema.parse(value);
    database.renameThread(threadId, title);
    return operationSuccessSchema.parse({ success: true });
  });
  ipcMain.handle(IPC_CHANNELS.setThreadStatus, (_event, value: unknown) => {
    const { threadId, status } = setThreadStatusRequestSchema.parse(value);
    database.setThreadStatus(threadId, status);
    return operationSuccessSchema.parse({ success: true });
  });
  ipcMain.handle(IPC_CHANNELS.deleteThread, (_event, value: unknown) => {
    const { threadId } = threadIdRequestSchema.parse(value);
    database.deleteThread(threadId);
    return operationSuccessSchema.parse({ success: true });
  });
  ipcMain.handle(IPC_CHANNELS.loadThreadMessages, (_event, value: unknown) => {
    const { threadId } = threadIdRequestSchema.parse(value);
    return database.loadThreadMessages(threadId);
  });
  ipcMain.handle(IPC_CHANNELS.appendThreadMessage, (_event, value: unknown) => {
    const request = appendThreadMessageRequestSchema.parse(value);
    database.appendThreadMessage(request);
    return operationSuccessSchema.parse({ success: true });
  });
  ipcMain.handle(IPC_CHANNELS.deleteThreadMessages, (_event, value: unknown) => {
    const { threadId, messageIds } = deleteThreadMessagesRequestSchema.parse(value);
    database.deleteThreadMessages(threadId, messageIds);
    return operationSuccessSchema.parse({ success: true });
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
  ipcMain.handle(IPC_CHANNELS.testModelConnection, (_event, value: unknown) => {
    const { id } = modelConfigIdRequestSchema.parse(value);
    return aiRuntime.testConnection(id);
  });
}

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1080,
    height: 720,
    minWidth: 760,
    minHeight: 520,
    show: false,
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
  databaseRuntime = openDatabase({
    userDataPath: app.getPath("userData"),
    appPath: app.getAppPath(),
  });
  return createCredentialStore({
    userDataPath: app.getPath("userData"),
    cipher: {
      isEncryptionAvailable: () => safeStorage.isAsyncEncryptionAvailable(),
      encryptString: (value) => safeStorage.encryptStringAsync(value),
      decryptString: (value) => safeStorage.decryptStringAsync(value),
    },
  });
}).then(async (credentialStore) => {
  if (databaseRuntime === undefined) {
    throw new Error("Database runtime was not initialized.");
  }
  Menu.setApplicationMenu(null);
  aiRuntime = await createAiRuntime({ database: databaseRuntime, credentialStore });
  registerIpcHandlers(databaseRuntime, aiRuntime, credentialStore);
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
