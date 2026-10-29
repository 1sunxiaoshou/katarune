import { OperationRejected, parseRequest } from "../diagnostics/operationRejected";
import { diagnostic } from "../diagnostics/logger";
import { ipcMain, type BrowserWindow } from "electron";
import { LIVE_CHANNELS, liveCredentialsSchema, liveWebCredentialsSchema, liveSettingsSchema, liveStateSchema, liveMonitorSchema } from "../../shared/live";
import { diagnosticIpcMain } from "../diagnostics/ipc";
import type { LiveService } from "../live/liveService";
import type { LiveMedia } from "../live/media";

export function registerLiveHandlers(live: LiveService, media: LiveMedia, window: BrowserWindow) {
  const guard = (event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent) => {
    if (window.isDestroyed() || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new OperationRejected("forbidden-source");
  };
  const handle = (channel: string, action: (value: unknown) => unknown) => diagnosticIpcMain.handle(channel, async (event, value: unknown) => {
    guard(event); return liveStateSchema.parse(await action(value));
  });
  handle(LIVE_CHANNELS.state, () => live.status);
  handle(LIVE_CHANNELS.settings, value => live.updateSettings(parseRequest(liveSettingsSchema, value)));
  handle(LIVE_CHANNELS.credentials, value => live.setCredentials(parseRequest(liveCredentialsSchema, value)));
  handle(LIVE_CHANNELS.webCredentials, value => live.setWebCredentials(parseRequest(liveWebCredentialsSchema, value)));
  handle(LIVE_CHANNELS.connect, () => live.connect());
  handle(LIVE_CHANNELS.disconnect, () => live.disconnect());
  handle(LIVE_CHANNELS.start, () => live.start());
  handle(LIVE_CHANNELS.stop, () => live.stop());
  handle(LIVE_CHANNELS.monitor, value => live.setMonitor(parseRequest(liveMonitorSchema, value).enabled));
  let subscribed = false, outstanding: number | null = null;
  live.subscribe(state => {
    if (window.isDestroyed()) return;
    window.webContents.send(LIVE_CHANNELS.changed, liveStateSchema.parse(state));
  });
  const update = () => { outstanding = null; };
  ipcMain.on(LIVE_CHANNELS.subscribePreview, (event, value: unknown) => {
    if (window.isDestroyed() || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) {
      diagnostic("warn", "live.preview-rejected", { outcome: "rejected", reasonCode: "forbidden-source" });
      return;
    }
    if (typeof value === "boolean") { subscribed = value; update(); }
    else if (Number.isSafeInteger(value) && outstanding === value) outstanding = null;
    else if (!Number.isSafeInteger(value)) diagnostic("warn", "live.preview-rejected", { outcome: "rejected", reasonCode: "invalid-input" });
  });
  window.on("minimize", update); window.on("restore", update); window.on("hide", update); window.on("show", update);
  window.webContents.on("render-process-gone", () => { subscribed = false; update(); });
  media.onPreview = frame => {
    if (!subscribed || outstanding !== null || window.isDestroyed() || !window.isVisible() || window.isMinimized()) return;
    outstanding = frame.sequence; window.webContents.send(LIVE_CHANNELS.preview, frame);
  };
}
