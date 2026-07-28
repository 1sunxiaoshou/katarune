import { AssistantRuntimeProvider, useRemoteThreadListRuntime } from "@assistant-ui/react";
import { useChatRuntime } from "@assistant-ui/react-ai-sdk";
import {
  lastAssistantMessageIsCompleteWithApprovalResponses,
  lastAssistantMessageIsCompleteWithToolCalls,
} from "ai";
import {
  createContext,
  useContext,
  useMemo,
  type PropsWithChildren,
} from "react";
import type { Character } from "../../shared/ipc";
import { useCharacterSession } from "./characters/CharacterSessionProvider";
import { KataruneChatTransport } from "./chat/KataruneChatTransport";
import { createKataruneThreadListAdapter } from "./persistence/threadAdapters";

const CharacterRuntimeConfigContext = createContext<Character | null>(null);

function useCharacterRuntimeConfig(): Character {
  const character = useContext(CharacterRuntimeConfigContext);
  if (character === null) {
    throw new Error("CharacterRuntimeConfigContext is missing.");
  }
  return character;
}

function ThreadRuntimeHook() {
  const character = useCharacterRuntimeConfig();
  const transport = useMemo(
    () => new KataruneChatTransport(character.id),
    [character.id],
  );
  return useChatRuntime({
    transport,
    isSendDisabled: character.modelConfigId === null,
    sendAutomaticallyWhen: (options) =>
      lastAssistantMessageIsCompleteWithToolCalls(options) ||
      lastAssistantMessageIsCompleteWithApprovalResponses(options),
  });
}

interface CharacterRuntimeHostProps extends PropsWithChildren {
  readonly active: boolean;
  readonly character: Character;
}

function CharacterRuntimeHost({
  active,
  character,
  children,
}: CharacterRuntimeHostProps): React.JSX.Element {
  const adapter = useMemo(
    () => createKataruneThreadListAdapter(character.id),
    [character.id],
  );
  const runtime = useRemoteThreadListRuntime({
    adapter,
    runtimeHook: ThreadRuntimeHook,
  });

  return (
    <CharacterRuntimeConfigContext.Provider value={character}>
      <AssistantRuntimeProvider runtime={runtime}>
        {active ? children : null}
      </AssistantRuntimeProvider>
    </CharacterRuntimeConfigContext.Provider>
  );
}

export function KataruneAssistantRuntimePool({
  children,
}: PropsWithChildren): React.JSX.Element {
  const { activeCharacter, visitedCharacters } = useCharacterSession();

  return (
    <>
      {[...visitedCharacters.values()].map((character) => (
        <CharacterRuntimeHost
          active={character.id === activeCharacter.id}
          character={character}
          key={character.id}
        >
          {children}
        </CharacterRuntimeHost>
      ))}
    </>
  );
}
