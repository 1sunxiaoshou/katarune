import { parseRequest } from "../diagnostics/operationRejected";
import { diagnosticIpcMain } from "../diagnostics/ipc";
import {
  characterIdRequestSchema,
  createCharacterRequestSchema,
  deleteCharacterResultSchema,
  IPC_CHANNELS,
  updateCharacterRequestSchema,
} from "../../shared/ipc";
import type { ChatStreamRegistry } from "../ai/chatStream";
import type { DatabaseRuntime } from "../database/database";
import type { LiveService } from "../live/liveService";

export function registerCharacterHandlers(
  database: DatabaseRuntime,
  chatStreams: ChatStreamRegistry,
  live?: LiveService,
): void {
  diagnosticIpcMain.handle(IPC_CHANNELS.listCharacters, () => database.listCharacters());
  diagnosticIpcMain.handle(IPC_CHANNELS.createCharacter, (_event, value: unknown) =>
    database.createCharacter(parseRequest(createCharacterRequestSchema, value)),
  );
  diagnosticIpcMain.handle(IPC_CHANNELS.deleteCharacter, async (_event, value: unknown) => {
    const { id } = parseRequest(characterIdRequestSchema, value);
    if (live?.active && live.status.settings.characterId === id) await live.stop(false);
    chatStreams.cancelCharacter(id);
    const result = deleteCharacterResultSchema.parse(database.deleteCharacter(id));
    if (live?.status.settings.characterId === id) await live.updateSettings({ ...live.status.settings, characterId: null });
    return result;
  });
  diagnosticIpcMain.handle(IPC_CHANNELS.updateCharacter, (_event, value: unknown) =>
    database.updateCharacter(parseRequest(updateCharacterRequestSchema, value)),
  );
}
