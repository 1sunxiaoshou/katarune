import { eq } from "drizzle-orm";
import { appStateSchema, type AppState, type Character } from "../../shared/ipc";
import { appState } from "./schema";
import type {
  AppStateRepository,
  KataruneDatabase,
} from "./types";

export function createAppStateRepository(
  database: KataruneDatabase,
  fetchCharacter: (id: string) => Character,
): AppStateRepository {
  const getAppState = (): AppState => {
    const state = database
      .select()
      .from(appState)
      .where(eq(appState.id, 1))
      .get();
    if (state === undefined) {
      throw new Error("Application state was not initialized.");
    }
    return appStateSchema.parse({
      activeCharacter: fetchCharacter(state.activeCharacterId),
    });
  };

  return {
    getAppState,
    setActiveCharacter: (characterId) => {
      fetchCharacter(characterId);
      database
        .update(appState)
        .set({ activeCharacterId: characterId, updatedAt: new Date() })
        .where(eq(appState.id, 1))
        .run();
      return getAppState();
    },
  };
}
