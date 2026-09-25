import { ipcMain, webContents } from "electron";
import {
  AVATAR_CHANNELS,
  avatarBindingSchema,
  avatarStatusSchema,
} from "../../shared/avatar";
import type { AvatarService } from "../avatar/avatarService";
import type { DatabaseRuntime } from "../database/database";

export function registerAvatarHandlers(
  avatar: AvatarService,
  database: DatabaseRuntime,
): void {
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
}
