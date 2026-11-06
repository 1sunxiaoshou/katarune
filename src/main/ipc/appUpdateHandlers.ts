import type { BrowserWindow } from "electron";
import { APP_UPDATE_CHANNELS, appUpdateStateSchema } from "../../shared/appUpdates";
import { diagnosticIpcMain } from "../diagnostics/ipc";
import { OperationRejected } from "../diagnostics/operationRejected";
import type { AppUpdateService } from "../updates/appUpdateService";

export function registerAppUpdateHandlers(service: AppUpdateService, getWindow: () => BrowserWindow | undefined): void {
  const handle = (channel: string, action: () => unknown) => diagnosticIpcMain.handle(channel, (event) => {
    const window = getWindow();
    if (!window || window.isDestroyed() || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) {
      throw new OperationRejected("forbidden-source");
    }
    return action();
  });
  handle(APP_UPDATE_CHANNELS.open, () => appUpdateStateSchema.parse(service.open()));
  handle(APP_UPDATE_CHANNELS.check, () => service.check());
  handle(APP_UPDATE_CHANNELS.apply, () => service.apply());
}
