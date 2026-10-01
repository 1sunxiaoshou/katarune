import { describe, expect, it, vi } from "vitest";
import { deleteCharacterWithMemory } from "../src/main/ipc/characterHandlers";
import type { DeleteCharacterResult } from "../src/shared/ipc";

const characterId = "00000000-0000-4000-8000-000000000001";
const replacementId = "00000000-0000-4000-8000-000000000002";
const now = new Date("2026-08-03T00:00:00.000Z");
const replacementCharacter = {
  id: replacementId,
  name: "Replacement",
  portraitAssetId: null,
  useDefaultSpeechModel: false, useDefaultSpeechVoice: false,
  modelConfigId: null,
  speechModelConfigId: null,
  speechVoice: null,
  systemPrompt: "test",
  createdAt: now,
  updatedAt: now,
};
const deletionResult: DeleteCharacterResult = {
  deletedCharacterId: characterId,
  deletedThreadCount: 2,
  replacementCharacter,
  activeCharacter: replacementCharacter,
};

function createMemoryWiki() {
  return {
    deleteCharacterMemoryTransaction: vi.fn(
      async (
        _id: string,
        deleteDatabaseRecord: () => unknown | Promise<unknown>,
      ): Promise<{ result: unknown; cleanupError: unknown | null }> => ({
        result: await deleteDatabaseRecord(),
        cleanupError: null,
      }),
    ),
  };
}

describe("character Memory Wiki lifecycle", () => {
  it("stages memory before deleting the database character and commits afterward", async () => {
    const events: string[] = [];
    const memoryWiki = createMemoryWiki();
    memoryWiki.deleteCharacterMemoryTransaction.mockImplementation(async (_id, action) => {
      events.push("stage");
      const result = await action();
      events.push("commit");
      return { result, cleanupError: null };
    });
    const database = {
      deleteCharacter: vi.fn(() => {
        events.push("database");
        return deletionResult;
      }),
    };
    const chatStreams = { cancelCharacter: vi.fn(() => events.push("cancel")) };

    await expect(
      deleteCharacterWithMemory(characterId, database, chatStreams, memoryWiki),
    ).resolves.toEqual(deletionResult);
    expect(events).toEqual(["cancel", "stage", "database", "commit"]);
  });

  it("propagates database deletion failures from the memory transaction", async () => {
    const memoryWiki = createMemoryWiki();
    const databaseError = new Error("database rejected deletion");
    const database = {
      deleteCharacter: vi.fn(() => {
        throw databaseError;
      }),
    };

    await expect(
      deleteCharacterWithMemory(
        characterId,
        database,
        { cancelCharacter: vi.fn() },
        memoryWiki,
      ),
    ).rejects.toBe(databaseError);
  });

  it("does not report a deleted database character as failed when trash cleanup is deferred", async () => {
    const memoryWiki = createMemoryWiki();
    memoryWiki.deleteCharacterMemoryTransaction.mockResolvedValue({
      result: deletionResult,
      cleanupError: new Error("file busy"),
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await expect(
        deleteCharacterWithMemory(
          characterId,
          { deleteCharacter: vi.fn(() => deletionResult) },
          { cancelCharacter: vi.fn() },
          memoryWiki,
        ),
      ).resolves.toEqual(deletionResult);
      expect(consoleError).toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });
});
