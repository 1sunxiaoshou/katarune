import { diagnosticIpcMain } from "../diagnostics/ipc";
import { BrowserWindow } from "electron";
import { characterIdRequestSchema } from "../../shared/ipc";
import {
  MEMORY_CHANNELS, listMemoryRequestSchema, memoryDiarySettingsSchema, memoryDiaryStateSchema,
  memoryEntrySchema, memoryIdRequestSchema, memoryListSchema, memoryVersionRequestSchema,
  memoryWriteResultSchema, saveMemoryRequestSchema,
} from "../../shared/memory";
import type { DatabaseRuntime } from "../database/database";

export function registerMemoryHandlers(database: DatabaseRuntime, retryDiaries?: () => void): void {
  database.subscribeMemoryChanges(characterId => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(MEMORY_CHANNELS.changed, { characterId });
    }
  });
  const requireActiveCharacter = (characterId: string) => {
    if (database.getAppState().activeCharacter.id !== characterId) throw new Error("请先切换到此记忆所属的角色。");
    database.fetchCharacter(characterId);
  };
  diagnosticIpcMain.handle(MEMORY_CHANNELS.retryDiary, (_event, value: unknown) => {
    const { id } = characterIdRequestSchema.parse(value);
    requireActiveCharacter(id);
    const state = database.retryMemoryDiaryJobs(id);
    retryDiaries?.();
    return memoryDiaryStateSchema.parse(state);
  });
  diagnosticIpcMain.handle(MEMORY_CHANNELS.list, (_event, value: unknown) => {
    const request = listMemoryRequestSchema.parse(value);
    requireActiveCharacter(request.characterId);
    return memoryListSchema.parse(database.listMemory(request));
  });
  diagnosticIpcMain.handle(MEMORY_CHANNELS.read, (_event, value: unknown) => {
    const request = memoryIdRequestSchema.parse(value);
    requireActiveCharacter(request.characterId);
    return memoryEntrySchema.parse(database.readMemory(request.characterId, request.id));
  });
  diagnosticIpcMain.handle(MEMORY_CHANNELS.save, (_event, value: unknown) => {
    const { characterId, ...request } = saveMemoryRequestSchema.parse(value);
    requireActiveCharacter(characterId);
    return memoryWriteResultSchema.parse(database.saveMemory(characterId, request));
  });
  diagnosticIpcMain.handle(MEMORY_CHANNELS.forget, (_event, value: unknown) => {
    const { characterId, id, revision } = memoryVersionRequestSchema.parse(value);
    requireActiveCharacter(characterId);
    return memoryWriteResultSchema.parse(database.forgetMemory(characterId, id, revision));
  });
  diagnosticIpcMain.handle(MEMORY_CHANNELS.diaryState, (_event, value: unknown) => {
    const { id } = characterIdRequestSchema.parse(value);
    requireActiveCharacter(id);
    return memoryDiaryStateSchema.parse(database.getMemoryDiaryState(id));
  });
  diagnosticIpcMain.handle(MEMORY_CHANNELS.diarySettings, (_event, value: unknown) => {
    const { characterId, enabled } = memoryDiarySettingsSchema.parse(value);
    requireActiveCharacter(characterId);
    return memoryDiaryStateSchema.parse(database.setMemoryDiaryEnabled(characterId, enabled));
  });
}
