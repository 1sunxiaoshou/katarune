import { AssistantRuntimeProvider, useRemoteThreadListRuntime } from "@assistant-ui/react";
import { useChatRuntime } from "@assistant-ui/react-ai-sdk";
import {
  lastAssistantMessageIsCompleteWithApprovalResponses,
  lastAssistantMessageIsCompleteWithToolCalls,
} from "ai";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";
import type { Character } from "../../shared/ipc";
import { useCharacterSession } from "./characters/CharacterSessionProvider";
import { KataruneChatTransport } from "./chat/KataruneChatTransport";
import { createKataruneThreadListAdapter } from "./persistence/threadAdapters";
import { KataruneSpeechSynthesisAdapter } from "./speech/KataruneSpeechSynthesisAdapter";
import {
  isCharacterSpeechAvailable,
  SPEECH_CONFIG_CHANGED_EVENT,
} from "./speech/speechAvailability";

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
  const [speechAvailable, setSpeechAvailable] = useState(false);
  const transport = useMemo(
    () => new KataruneChatTransport(character.id),
    [character.id],
  );
  useEffect(() => {
    let active = true;
    const refresh = (): void => {
      void isCharacterSpeechAvailable(character)
        .then((available) => {
          if (active) setSpeechAvailable(available);
        })
        .catch(() => {
          if (active) setSpeechAvailable(false);
        });
    };
    refresh();
    window.addEventListener(SPEECH_CONFIG_CHANGED_EVENT, refresh);
    return () => {
      active = false;
      window.removeEventListener(SPEECH_CONFIG_CHANGED_EVENT, refresh);
    };
  }, [character]);
  const speech = useMemo(
    () =>
      !speechAvailable ||
      character.speechModelConfigId === null ||
      character.speechVoice === null
        ? undefined
        : new KataruneSpeechSynthesisAdapter(character.id),
    [
      character.id,
      character.speechModelConfigId,
      character.speechVoice,
      speechAvailable,
    ],
  );
  useEffect(() => () => speech?.dispose(), [speech]);
  return useChatRuntime({
    transport,
    adapters: { speech },
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
