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
}
