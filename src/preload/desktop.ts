import { DESKTOP_CHANNELS } from "../shared/avatarDesktopChannels";
import { contextBridge, ipcRenderer } from "electron";
import type {
  AvatarDesktopApi,
  DesktopSnapshot,
} from "../shared/avatarDesktop";
const api: AvatarDesktopApi = {
  getState: () => ipcRenderer.invoke(DESKTOP_CHANNELS.get),
  command: (command) => ipcRenderer.invoke(DESKTOP_CHANNELS.command, command),
  subscribe: (listener) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      state: DesktopSnapshot,
    ) => listener(state);
    ipcRenderer.on(DESKTOP_CHANNELS.state, handler);
    return () => {
      ipcRenderer.removeListener(DESKTOP_CHANNELS.state, handler);
    };
  },
};
contextBridge.exposeInMainWorld("avatarDesktop", api);
