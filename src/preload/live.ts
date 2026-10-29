import { ipcRenderer } from "electron";
import { LIVE_CHANNELS, liveCredentialsSchema, liveWebCredentialsSchema, liveSettingsSchema, liveStateSchema, liveMonitorSchema, livePreviewSchema, type LiveApi } from "../shared/live";

const invoke = async (channel: string, value?: unknown) => liveStateSchema.parse(await ipcRenderer.invoke(channel, value));
export const liveApi: LiveApi = {
  getLiveState: () => invoke(LIVE_CHANNELS.state),
  updateLiveSettings: value => invoke(LIVE_CHANNELS.settings, liveSettingsSchema.parse(value)),
  setLiveCredentials: value => invoke(LIVE_CHANNELS.credentials, liveCredentialsSchema.parse(value)),
  setLiveWebCredentials: value => invoke(LIVE_CHANNELS.webCredentials, liveWebCredentialsSchema.parse(value)),
  connectLiveRoom: () => invoke(LIVE_CHANNELS.connect), disconnectLiveRoom: () => invoke(LIVE_CHANNELS.disconnect),
  startLive: () => invoke(LIVE_CHANNELS.start), stopLive: () => invoke(LIVE_CHANNELS.stop),
  setLiveMonitor: value => invoke(LIVE_CHANNELS.monitor, liveMonitorSchema.parse(value)),
  onLiveChanged: listener => {
    const callback = (_: Electron.IpcRendererEvent, value: unknown) => { const state = liveStateSchema.safeParse(value); if (state.success) listener(state.data); };
    ipcRenderer.on(LIVE_CHANNELS.changed, callback); return () => { ipcRenderer.removeListener(LIVE_CHANNELS.changed, callback); };
  },
  onLivePreview: listener => {
    const callback = async (_: Electron.IpcRendererEvent, value: unknown) => {
      const frame = livePreviewSchema.safeParse(value);
      try { if (frame.success) await listener(frame.data); }
      catch { /* The preview owns presentation errors; always release backpressure. */ }
      finally { if (frame.success) ipcRenderer.send(LIVE_CHANNELS.subscribePreview, frame.data.sequence); }
    };
    ipcRenderer.on(LIVE_CHANNELS.preview, callback); ipcRenderer.send(LIVE_CHANNELS.subscribePreview, true);
    return () => { ipcRenderer.removeListener(LIVE_CHANNELS.preview, callback); ipcRenderer.send(LIVE_CHANNELS.subscribePreview, false); };
  },
};
