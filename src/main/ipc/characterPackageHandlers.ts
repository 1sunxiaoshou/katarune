import { BrowserWindow, dialog, ipcMain } from "electron";
import {
  PACKAGE_CHANNELS,
  packageIdRequestSchema,
  packageImportRequestSchema,
  packageBindSchema,
} from "../../shared/characterPackages";
import type { CharacterPackageService } from "../characters/characterPackageService";
import type { DatabaseRuntime } from "../database/database";
import type { AvatarService } from "../avatar/avatarService";

export function registerCharacterPackageHandlers(
  service: CharacterPackageService,
  db: DatabaseRuntime,
  avatar: AvatarService,
): void {
  const owners = new Map<string, { senderId: number; canceled: boolean }>();
  const binding = new Set<string>();
  ipcMain.handle(PACKAGE_CHANNELS.list, () => service.list());
  ipcMain.handle(PACKAGE_CHANNELS.detail, (_event, value: unknown) =>
    service.detail(packageIdRequestSchema.parse(value).id),
  );
  ipcMain.handle(PACKAGE_CHANNELS.remove, (_event, value: unknown) => {
    service.remove(packageIdRequestSchema.parse(value).id);
    return { success: true };
  });
  ipcMain.handle(PACKAGE_CHANNELS.cancel, (event, value: unknown) => {
    const { requestId } = packageImportRequestSchema.parse(value);
    const job = owners.get(requestId);
    if (job?.senderId === event.sender.id) {
      job.canceled = true;
      service.cancel(requestId);
    }
    return { success: true };
  });
  ipcMain.handle(PACKAGE_CHANNELS.import, async (event, value: unknown) => {
    const { requestId } = packageImportRequestSchema.parse(value);
    if (owners.has(requestId)) throw new Error("重复导入请求。");
    const job = { senderId: event.sender.id, canceled: false };
    owners.set(requestId, job);
    const cancel = () => {
      job.canceled = true;
      service.cancel(requestId);
    };
    event.sender.once("destroyed", cancel);
    try {
      const owner = BrowserWindow.fromWebContents(event.sender);
      const options = {
        properties: ["openFile" as const],
        filters: [
          { name: "角色包", extensions: ["katarune-character", "zip"] },
        ],
      };
      const selection = owner
        ? await dialog.showOpenDialog(owner, options)
        : await dialog.showOpenDialog(options);
      if (job.canceled || selection.canceled || !selection.filePaths[0])
        return { canceled: true, package: null };
      const pack = await service.import(
        selection.filePaths[0],
        requestId,
        (value) => {
          if (!event.sender.isDestroyed())
            event.sender.send(PACKAGE_CHANNELS.progress, value);
        },
      );
      return { canceled: false, package: pack };
    } finally {
      owners.delete(requestId);
      event.sender.removeListener("destroyed", cancel);
    }
  });
  ipcMain.handle(PACKAGE_CHANNELS.bind, async (_event, value: unknown) => {
    const { characterId, packageId } = packageBindSchema.parse(value);
    if (binding.has(characterId)) throw new Error("角色包正在切换，请稍候。");
    binding.add(characterId);
    const releases: (() => void)[] = [];
    try {
      const previous = db.fetchCharacter(characterId).packageId!;
      releases.push(service.retain(previous));
      releases.push(service.retain(packageId));
      await avatar.switchPackage(characterId, service.runtime(packageId));
      try {
        db.bindCharacterPackage(characterId, packageId);
      } catch (error) {
        await avatar.switchPackage(characterId, service.runtime(previous));
        throw error;
      }
      return db.fetchCharacter(characterId);
    } finally {
      releases.forEach((release) => release());
      binding.delete(characterId);
    }
  });
}
