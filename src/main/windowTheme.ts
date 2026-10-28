import { ipcMain, type BrowserWindow, type WebContents } from "electron";
import { IPC_CHANNELS, windowThemeSchema } from "../shared/ipc";

export function registerWindowThemeHandler(getWindow: (sender: WebContents) => BrowserWindow | undefined): void {
  ipcMain.handle(IPC_CHANNELS.setWindowTheme, (event, value: unknown) => {
    const theme = windowThemeSchema.parse(value);
    const window = getWindow(event.sender);
    if (!window || window.isDestroyed() || event.sender !== window.webContents || event.senderFrame !== event.sender.mainFrame) {
      throw new Error("无法修改此窗口的主题。");
    }
    const background = theme === "dark" ? "#0a0a0a" : "#ffffff";
    window.setBackgroundColor(background);
    // Electron applies this to the native Windows caption and frame via DWM.
    if (process.platform === "win32") window.setAccentColor(background);
    return { success: true };
  });
}
