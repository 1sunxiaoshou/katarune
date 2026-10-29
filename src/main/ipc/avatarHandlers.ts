import { OperationRejected, parseRequest } from "../diagnostics/operationRejected";
import { diagnosticIpcMain } from "../diagnostics/ipc";
import { BrowserWindow } from "electron";
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

let chatWindow: BrowserWindow | undefined;
export function setAvatarChatWindow(window: BrowserWindow): void { chatWindow = window; }

export function registerAvatarHandlers(
  avatar: AvatarService,
  database: DatabaseRuntime,
): void {
  avatar.onOpenChat = () => {
    const window = chatWindow;
    if (!window || window.isDestroyed()) return;
    if (window.isMinimized()) window.restore();
    window.show(); window.focus();
  };
  avatar.subscribe(status => {
    if (chatWindow && !chatWindow.isDestroyed()) chatWindow.webContents.send(AVATAR_CHANNELS.changed, status);
  });
  diagnosticIpcMain.handle(AVATAR_CHANNELS.start, async (_event, value: unknown) => {
    if (avatar.liveActive) return avatarStatusSchema.parse(avatar.status);
    const binding = parseRequest(avatarBindingSchema, value);
    database.fetchCharacter(binding.characterId);
    return avatarStatusSchema.parse(await avatar.start(binding));
  });
  diagnosticIpcMain.handle(AVATAR_CHANNELS.stop, () => {
    if (avatar.liveActive) throw new OperationRejected("operation-not-allowed", "请从直播页面停止直播。");
    return avatarStatusSchema.parse(avatar.stop());
  });
  diagnosticIpcMain.handle(AVATAR_CHANNELS.status, () =>
    avatarStatusSchema.parse(avatar.status),
  );
  diagnosticIpcMain.handle(AVATAR_CHANNELS.voiceState, (_event, value: unknown) => {
    if (avatar.liveActive) return;
    const request = parseRequest(avatarVoiceStateSchema, value);
    avatar.setVoiceState(request.binding, request.phase, request.error, request.level);
  });
  diagnosticIpcMain.handle(AVATAR_CHANNELS.playbackControl, (_event, value: unknown) => {
    if (avatar.liveActive) return;
    const request = parseRequest(avatarPlaybackControlSchema, value);
    avatar.controlPlayback(request.binding, request.action);
  });
  diagnosticIpcMain.handle(AVATAR_CHANNELS.userSubtitle, (_event, value: unknown) => {
    if (avatar.liveActive) return;
    const request = parseRequest(avatarUserSubtitleSchema, value);
    avatar.showUserSubtitle(request.binding, request.text);
  });
}
