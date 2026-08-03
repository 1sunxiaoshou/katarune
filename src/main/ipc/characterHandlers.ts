import { BrowserWindow, dialog, ipcMain } from "electron";
import {
  characterIdRequestSchema,
  characterPortraitCommitRequestSchema,
  characterPortraitStageIdRequestSchema,
  characterPortraitStageResultSchema,
  characterSchema,
  createCharacterRequestSchema,
  deleteCharacterResultSchema,
  IPC_CHANNELS,
  operationSuccessSchema,
  updateCharacterRequestSchema,
} from "../../shared/ipc";
import type { ChatStreamRegistry } from "../ai/chatStream";
import type { AssetService } from "../assets/assetService";
import type { DatabaseRuntime } from "../database/database";
import type { MemoryWikiService } from "../memory/memoryWikiService";

export async function deleteCharacterWithMemory(
  id: string,
  database: Pick<DatabaseRuntime, "deleteCharacter">,
  chatStreams: Pick<ChatStreamRegistry, "cancelCharacter">,
  memoryWiki: Pick<MemoryWikiService, "deleteCharacterMemoryTransaction">,
) {
  chatStreams.cancelCharacter(id);
  const { result, cleanupError } = await memoryWiki.deleteCharacterMemoryTransaction(
    id,
    () => database.deleteCharacter(id),
  );
  if (cleanupError !== null) {
    console.error("Failed to clean staged character memory.", cleanupError);
  }
  return result;
}

export function registerCharacterHandlers(
  database: DatabaseRuntime,
  assetService: AssetService,
  chatStreams: ChatStreamRegistry,
  memoryWiki: MemoryWikiService,
): void {
  ipcMain.handle(IPC_CHANNELS.listCharacters, () => database.listCharacters());
  ipcMain.handle(IPC_CHANNELS.createCharacter, (_event, value: unknown) =>
    database.createCharacter(createCharacterRequestSchema.parse(value)),
  );
  ipcMain.handle(IPC_CHANNELS.deleteCharacter, async (_event, value: unknown) => {
    const { id } = characterIdRequestSchema.parse(value);
    return deleteCharacterResultSchema.parse(
      await deleteCharacterWithMemory(id, database, chatStreams, memoryWiki),
    );
  });
  ipcMain.handle(IPC_CHANNELS.updateCharacter, (_event, value: unknown) =>
    database.updateCharacter(updateCharacterRequestSchema.parse(value)),
  );
  ipcMain.handle(
    IPC_CHANNELS.stageCharacterPortrait,
    async (event) => {
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
        return characterPortraitStageResultSchema.parse({
          canceled: true,
          stage: null,
        });
      }

      return characterPortraitStageResultSchema.parse({
        canceled: false,
        stage: assetService.stagePortrait(selection.filePaths[0]),
      });
    },
  );
  ipcMain.handle(
    IPC_CHANNELS.commitCharacterPortrait,
    (_event, value: unknown) => {
      const request = characterPortraitCommitRequestSchema.parse(value);
      if (request.mode === "existing" && request.stageId === null) {
        return characterSchema.parse(
          database.updateCharacterPortrait(request.id, request.framing),
        );
      }
      const stageId = request.stageId;
      if (stageId === null) {
        throw new Error("需要先选择立绘。");
      }
      return characterSchema.parse(
        assetService.commitStagedPortrait(stageId, (asset) =>
          request.mode === "existing"
            ? database.updateCharacterPortrait(
                request.id,
                request.framing,
                asset,
              )
            : database.createCharacter(
                request.character,
                asset,
                request.framing,
              ),
        ),
      );
    },
  );
  ipcMain.handle(
    IPC_CHANNELS.discardCharacterPortraitStage,
    (_event, value: unknown) => {
      const { stageId } = characterPortraitStageIdRequestSchema.parse(value);
      assetService.discardStagedPortrait(stageId);
      return operationSuccessSchema.parse({ success: true });
    },
  );
}
