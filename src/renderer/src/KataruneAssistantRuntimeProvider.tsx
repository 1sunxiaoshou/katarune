import {
  AssistantRuntimeProvider,
  useAui,
  useAuiState,
  useRemoteThreadListRuntime,
} from "@assistant-ui/react";
import { useAISDKRuntime } from "@assistant-ui/react-ai-sdk";
import { useChat } from "@ai-sdk/react";
import { createChatSendQueue } from "./chat/chatSendQueue";
import { useAvatarState } from "./chat/avatarState";
import { AvatarToolUI } from "./chat/AvatarToolUI";
import {
  lastAssistantMessageIsCompleteWithApprovalResponses,
  lastAssistantMessageIsCompleteWithToolCalls,
} from "ai";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";
import type { Character } from "../../shared/ipc";
import { useCharacterSession } from "./characters/CharacterSessionProvider";
import { KataruneChatTransport } from "./chat/KataruneChatTransport";
import { KataruneAttachmentAdapter } from "./chat/KataruneAttachmentAdapter";
import { MemoryWikiToolUI } from "./chat/MemoryWikiToolUI";
import { ViewChatImageToolUI } from "./chat/ViewChatImageToolUI";
import { createKataruneThreadListAdapter } from "./persistence/threadAdapters";
import { KataruneSpeechSynthesisAdapter } from "./speech/KataruneSpeechSynthesisAdapter";
import {
  isCharacterSpeechAvailable,
  SPEECH_CONFIG_CHANGED_EVENT,
} from "./speech/speechAvailability";
import { useApplicationSettings } from "./settings/ApplicationSettingsProvider";

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
  const aui = useAui();
  const threadId = useAuiState((s) => s.threadListItem.id);
  const remoteId = useAuiState((s) => s.threadListItem.remoteId);
  const avatar = useAvatarState((s) => s.status);
  const avatarBound =
    avatar.phase === "ready" &&
    avatar.binding?.characterId === character.id &&
    avatar.binding.threadId === (remoteId ?? threadId);
  const { appSettings } = useApplicationSettings();
  const [speechAvailable, setSpeechAvailable] = useState(false);
  const transport = useMemo(
    () =>
      new KataruneChatTransport(
        character.id,
        async () => (await aui.threadListItem().initialize()).remoteId,
      ),
    [character.id, aui],
  );
  const attachments = useMemo(() => new KataruneAttachmentAdapter(), []);
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
        : new KataruneSpeechSynthesisAdapter(character.id, remoteId ?? threadId),
    [
      character.id,
      character.speechModelConfigId,
      character.speechVoice,
      speechAvailable,
      threadId,
      remoteId,
    ],
  );
  useEffect(() => () => speech?.dispose(), [speech]);
  const chat = useChat({
    id: threadId,
    transport,
    sendAutomaticallyWhen: (options) => {
      if (lastAssistantMessageIsCompleteWithApprovalResponses(options))
        return true;
      const parts = options.messages.at(-1)?.parts ?? [];
      if (
        parts.some(
          (p) =>
            p.type === "tool-avatar_action" ||
            p.type === "tool-set_expression",
        )
      )
        return false;
      return lastAssistantMessageIsCompleteWithToolCalls(options);
    },
  });
  const sendRef = useRef(chat.sendMessage);
  sendRef.current = chat.sendMessage;
  const queue = useMemo(
    () =>
      createChatSendQueue(
        (...args) => sendRef.current(...args),
        (count) => useAvatarState.getState().setQueued(threadId, count),
      ),
    [threadId],
  );
  useEffect(() => {
    queue.activate();
    return () => queue.dispose();
  }, [queue]);
  const runtime = useAISDKRuntime(
    { ...chat, sendMessage: avatarBound ? queue.send : chat.sendMessage },
    {
      adapters: { attachments, speech },
      cancelPendingToolCallsOnSend: !avatarBound,
      isSendDisabled:
        character.modelConfigId === null &&
        appSettings.defaultLanguageModelConfigId === null,
    },
  );
  transport.setRuntime(runtime);
  return runtime;
}

function AutoReadReplies(): null {
  const aui = useAui();
  const { autoReadReplies } = useApplicationSettings();
  const isRunning = useAuiState((state) => state.thread.isRunning);
  const canSpeak = useAuiState((state) => state.thread.capabilities.speech);
  const wasRunning = useRef(isRunning);
  const lastSpokenMessageId = useRef<string | null>(null);
  const character = useCharacterRuntimeConfig();
  const threadId = useAuiState((s) => s.threadListItem.id);
  const remoteId = useAuiState((s) => s.threadListItem.remoteId);
  const avatarActive = useAvatarState((s) => s.status.phase === "ready"
    && s.status.binding?.characterId === character.id
    && s.status.binding?.threadId === (remoteId ?? threadId));
  const handledByAvatar = useRef(isRunning && avatarActive);

  useEffect(() => {
    if (isRunning && !wasRunning.current) handledByAvatar.current = avatarActive;
    const completedRun = wasRunning.current && !isRunning;
    wasRunning.current = isRunning;
    if (!completedRun || !autoReadReplies || !canSpeak || handledByAvatar.current) return;

    const timer = window.setTimeout(() => {
      const thread = aui.thread().getState();
      if (thread.isRunning || !thread.capabilities.speech) return;
      const message = thread.messages.at(-1);
      if (
        message === undefined ||
        message.role !== "assistant" ||
        message.status?.type !== "complete" ||
        !message.content.some(
          (part) => part.type === "text" && part.text.trim().length > 0,
        ) ||
        lastSpokenMessageId.current === message.id
      ) {
        return;
      }
      lastSpokenMessageId.current = message.id;
      aui.thread().message({ id: message.id }).speak();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [aui, autoReadReplies, canSpeak, isRunning, avatarActive]);

  return null;
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
        {active ? (
          <>
            <AutoReadReplies />
            <MemoryWikiToolUI />
            <ViewChatImageToolUI />
            <AvatarToolUI />
            {children}
          </>
        ) : null}
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
