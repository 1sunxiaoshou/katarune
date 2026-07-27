import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";
import type { Character, DeleteCharacterResult } from "../../../shared/ipc";
import { Button } from "@/components/ui/button";

interface CharacterSession {
  readonly activeCharacter: Character;
  readonly deleteCharacter: (characterId: string) => Promise<DeleteCharacterResult>;
  readonly setActiveCharacter: (characterId: string) => Promise<Character>;
}

const CharacterSessionContext = createContext<CharacterSession | null>(null);

export function CharacterSessionProvider({
  children,
}: PropsWithChildren): React.JSX.Element {
  const [activeCharacter, setActiveCharacterState] = useState<Character | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let active = true;
    setError(null);
    void window.katarune
      .getAppState()
      .then((state) => {
        if (active) setActiveCharacterState(state.activeCharacter);
      })
      .catch((loadError: unknown) => {
        if (active) {
          setError(
            loadError instanceof Error ? loadError.message : "无法读取活动角色。",
          );
        }
      });
    return () => {
      active = false;
    };
  }, [reloadToken]);

  const setActiveCharacter = useCallback(async (characterId: string) => {
    const state = await window.katarune.setActiveCharacter({ characterId });
    setActiveCharacterState(state.activeCharacter);
    return state.activeCharacter;
  }, []);

  const deleteCharacter = useCallback(async (characterId: string) => {
    const result = await window.katarune.deleteCharacter({ id: characterId });
    setActiveCharacterState(result.activeCharacter);
    return result;
  }, []);

  const value = useMemo(
    () =>
      activeCharacter === null
        ? null
        : { activeCharacter, deleteCharacter, setActiveCharacter },
    [activeCharacter, deleteCharacter, setActiveCharacter],
  );

  if (error !== null) {
    return (
      <main className="grid h-dvh place-items-center text-sm" role="alert">
        <div className="grid justify-items-center gap-3">
          <p>{error}</p>
          <Button onClick={() => setReloadToken((value) => value + 1)} variant="outline">
            重试
          </Button>
        </div>
      </main>
    );
  }
  if (value === null) {
    return (
      <main className="grid h-dvh place-items-center text-sm text-muted-foreground" role="status">
        正在读取活动角色……
      </main>
    );
  }

  return (
    <CharacterSessionContext.Provider value={value}>
      {children}
    </CharacterSessionContext.Provider>
  );
}

export function useCharacterSession(): CharacterSession {
  const session = useContext(CharacterSessionContext);
  if (session === null) {
    throw new Error("CharacterSessionProvider is missing.");
  }
  return session;
}
