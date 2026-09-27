import { BrowserWindow, ipcMain, webContents } from "electron";
import {
  AVATAR_CHANNELS,
  avatarBindingSchema,
  avatarStatusSchema,
  avatarVoiceStateSchema,
  avatarPlaybackControlSchema,
  avatarUserSubtitleSchema,
} from "../../shared/avatar";
import type { AvatarService } from "../avatar/avatarService";
import type { DatabaseRuntime } from "../database/database";

export function registerAvatarHandlers(
  avatar: AvatarService,
  database: DatabaseRuntime,
): void {
  avatar.onOpenChat = () => {
    const window = BrowserWindow.getAllWindows()[0];
    if (!window) return;
    if (window.isMinimized()) window.restore();
    window.show(); window.focus();
  };
  avatar.subscribe(status => {
    for (const contents of webContents.getAllWebContents()) {
      if (!contents.isDestroyed()) contents.send(AVATAR_CHANNELS.changed, status);
    }
  });
  ipcMain.handle(AVATAR_CHANNELS.start, async (_event, value: unknown) => {
    const binding = avatarBindingSchema.parse(value);
    database.fetchCharacter(binding.characterId);
    return avatarStatusSchema.parse(await avatar.start(binding));
  });
  ipcMain.handle(AVATAR_CHANNELS.stop, () =>
    avatarStatusSchema.parse(avatar.stop()),
  );
  ipcMain.handle(AVATAR_CHANNELS.status, () =>
    avatarStatusSchema.parse(avatar.status),
  );
  ipcMain.handle(AVATAR_CHANNELS.voiceState, (_event, value: unknown) => {
    const request = avatarVoiceStateSchema.parse(value);
    avatar.setVoiceState(request.binding, request.phase, request.error, request.level);
  });
  ipcMain.handle(AVATAR_CHANNELS.playbackControl, (_event, value: unknown) => {
    const request = avatarPlaybackControlSchema.parse(value);
    avatar.controlPlayback(request.binding, request.action);
  });
  ipcMain.handle(AVATAR_CHANNELS.userSubtitle, (_event, value: unknown) => {
    const request = avatarUserSubtitleSchema.parse(value);
    avatar.showUserSubtitle(request.binding, request.text);
  });
}
