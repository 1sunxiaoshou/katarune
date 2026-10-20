import { ipcMain } from "electron";
import {
  characterIdRequestSchema,
  createCharacterRequestSchema,
  deleteCharacterResultSchema,
  IPC_CHANNELS,
  updateCharacterRequestSchema,
} from "../../shared/ipc";
import type { ChatStreamRegistry } from "../ai/chatStream";
import type { DatabaseRuntime } from "../database/database";

export function registerCharacterHandlers(
  database: DatabaseRuntime,
  chatStreams: ChatStreamRegistry,
): void {
  ipcMain.handle(IPC_CHANNELS.listCharacters, () => database.listCharacters());
  ipcMain.handle(IPC_CHANNELS.createCharacter, (_event, value: unknown) =>
    database.createCharacter(createCharacterRequestSchema.parse(value)),
  );
  ipcMain.handle(IPC_CHANNELS.deleteCharacter, async (_event, value: unknown) => {
    const { id } = characterIdRequestSchema.parse(value);
    chatStreams.cancelCharacter(id);
    return deleteCharacterResultSchema.parse(
      database.deleteCharacter(id),
    );
  });
  ipcMain.handle(IPC_CHANNELS.updateCharacter, (_event, value: unknown) =>
    database.updateCharacter(updateCharacterRequestSchema.parse(value)),
  );
}
