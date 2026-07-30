import { BrowserWindow, dialog, ipcMain } from "electron";
import {
  characterIdRequestSchema,
  characterPortraitImportRequestSchema,
  characterPortraitImportResultSchema,
  createCharacterRequestSchema,
  deleteCharacterResultSchema,
  IPC_CHANNELS,
  updateCharacterRequestSchema,
} from "../../shared/ipc";
import type { ChatStreamRegistry } from "../ai/chatStream";
import type { AssetService } from "../assets/assetService";
import type { DatabaseRuntime } from "../database/database";

export function registerCharacterHandlers(
  database: DatabaseRuntime,
  assetService: AssetService,
  chatStreams: ChatStreamRegistry,
): void {
  ipcMain.handle(IPC_CHANNELS.listCharacters, () => database.listCharacters());
  ipcMain.handle(IPC_CHANNELS.createCharacter, (_event, value: unknown) =>
    database.createCharacter(createCharacterRequestSchema.parse(value)),
  );
  ipcMain.handle(IPC_CHANNELS.deleteCharacter, (_event, value: unknown) => {
    const { id } = characterIdRequestSchema.parse(value);
    chatStreams.cancelCharacter(id);
    return deleteCharacterResultSchema.parse(database.deleteCharacter(id));
  });
  ipcMain.handle(IPC_CHANNELS.updateCharacter, (_event, value: unknown) =>
    database.updateCharacter(updateCharacterRequestSchema.parse(value)),
  );
  ipcMain.handle(
    IPC_CHANNELS.importCharacterPortrait,
    async (event, value: unknown) => {
      const request = characterPortraitImportRequestSchema.parse(value);
      if (request.mode === "existing") database.fetchCharacter(request.id);
      const owner = BrowserWindow.fromWebContents(event.sender);
      const selection =
        owner === null
          ? await dialog.showOpenDialog({
              properties: ["openFile"],
              filters: [
                {
                  name: "角色立绘",
                  extensions: ["png", "jpg", "jpeg", "webp"],
                },
              ],
            })
          : await dialog.showOpenDialog(owner, {
              properties: ["openFile"],
              filters: [
                {
                  name: "角色立绘",
                  extensions: ["png", "jpg", "jpeg", "webp"],
                },
              ],
            });

      if (selection.canceled || selection.filePaths[0] === undefined) {
        return characterPortraitImportResultSchema.parse({
          canceled: true,
          character: null,
        });
      }

      const registration = assetService.importPortrait(selection.filePaths[0]);
      let updated;
      try {
        updated =
          request.mode === "existing"
            ? database.registerAssetAndSetCharacterPortrait(
                request.id,
                registration,
              )
            : database.createCharacter(request.character, registration);
      } catch (error) {
        assetService.removeExact(registration.id);
        throw error;
      }
      return characterPortraitImportResultSchema.parse({
        canceled: false,
        character: updated,
      });
    },
  );
}
