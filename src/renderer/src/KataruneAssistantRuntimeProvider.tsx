import {
  AssistantRuntimeProvider,
  useAui,
  useAuiState,
  useRemoteThreadListRuntime,
} from "@assistant-ui/react";
import { useAISDKRuntime } from "@assistant-ui/react-ai-sdk";
import { useChat } from "@ai-sdk/react";
import { realtimeVoice } from "./speech/realtimeVoice";
import { createChatSendQueue } from "./chat/chatSendQueue";
import { interruptForVoice } from "./chat/voiceInterruption";
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
import { KataruneDictationAdapter } from './speech/KataruneDictationAdapter';
import {
  isCharacterSpeechAvailable,
  SPEECH_CONFIG_CHANGED_EVENT,
} from "./speech/speechAvailability";
import { useApplicationSettings } from "./settings/ApplicationSettingsProvider";

const CharacterRuntimeConfigContext = createContext<Character | null>(null);
const echoText = (value: string) => value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

function useCharacterRuntimeConfig(): Character {
  const character = useContext(CharacterRuntimeConfigContext);
  if (character === null) {
    throw new Error("CharacterRuntimeConfigContext is missing.");
  }
  return character;
}

function ThreadRuntimeHook() {
  const dictation = useMemo(() => new KataruneDictationAdapter(), []);
  useEffect(() => () => dictation.dispose(), [dictation]);
  const character = useCharacterRuntimeConfig();
  const aui = useAui();
  const threadId = useAuiState((s) => s.threadListItem.id);
  const remoteId = useAuiState((s) => s.threadListItem.remoteId);
  const resolvedThreadId = remoteId ?? threadId;
  const avatar = useAvatarState((s) => s.status);
  const avatarBound =
    avatar.phase === "ready" &&
    avatar.binding?.characterId === character.id &&
    avatar.binding.threadId === (remoteId ?? threadId);
  const { appSettings } = useApplicationSettings();
  const [speechAvailable, setSpeechAvailable] = useState<boolean | null>(null);
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
    setSpeechAvailable(null);
    const refresh = (): void => {
      void isCharacterSpeechAvailable(character, appSettings)
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
  }, [character, appSettings]);
  const speech = useMemo(
    () =>
      !speechAvailable
        ? undefined
        : new KataruneSpeechSynthesisAdapter(character.id, remoteId ?? threadId),
    [
      character.id,
      appSettings,
      character.useDefaultSpeechModel,
      character.useDefaultSpeechVoice,
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
  const chatRef = useRef(chat);
  chatRef.current = chat;
  const sendRef = useRef(chat.sendMessage);
  sendRef.current = chat.sendMessage;
  const queue = useMemo(
    () =>
      createChatSendQueue(
        (...args) => sendRef.current(...args),
        (count) => useAvatarState.getState().setQueued(threadId, count),
        priority => { if (!priority) realtimeVoice.beforeSend({ characterId: character.id, threadId: remoteId ?? threadId }); },
      ),
    [threadId, resolvedThreadId, character.id],
  );
  useEffect(() => {
    queue.activate();
    return () => queue.dispose();
  }, [queue]);
  const runtime = useAISDKRuntime(
    { ...chat, sendMessage: avatarBound ? queue.send : chat.sendMessage },
    {
      adapters: { attachments, speech, dictation },
      cancelPendingToolCallsOnSend: !avatarBound,
      isSendDisabled:
        character.modelConfigId === null &&
        appSettings.defaultLanguageModelConfigId === null,
    },
  );
  transport.setRuntime(runtime);
  const voiceState = useRef({ busy: false, available: false, pending: true, error: chat.error });
  voiceState.current = {
    busy: chat.status === "submitted" || chat.status === "streaming",
    available: appSettings.defaultAsrModel !== null && speechAvailable === true
      && (character.modelConfigId !== null || appSettings.defaultLanguageModelConfigId !== null),
    pending: speechAvailable === null,
    error: chat.error,
  };
  const voiceSend = useRef(queue);
  voiceSend.current = queue;
  useEffect(() => realtimeVoice.register({ characterId: character.id, threadId: remoteId ?? threadId }, {
    state: () => voiceState.current,
    isLikelyEcho: text => {
      const phrase = echoText(text);
      if (phrase.length < 4) return false;
      const messages = chatRef.current.messages;
      for (let i = messages.length - 1; i >= 0; i--) {
        const message = messages[i];
        if (message?.role !== 'assistant') continue;
        const spoken = echoText(message.parts.filter(part => part.type === 'text').map(part => part.text).join(''));
        return spoken.includes(phrase);
      }
      return false;
    },
    send: text => voiceSend.current.prioritySend({ text }),
    interrupt: async text => {
      let previousAssistantId: string | undefined;
      for (let i = chatRef.current.messages.length - 1; i >= 0; i--) {
        const message = chatRef.current.messages[i];
        if (message?.role === 'assistant') { previousAssistantId = message.id; break; }
      }
      await interruptForVoice({
        enqueue: () => voiceSend.current.prioritySend({ text }),
        isGenerating: () => voiceState.current.busy,
        stopGeneration: () => chatRef.current.stop(),
        markReply: incomplete => chatRef.current.setMessages(messages => {
        let index = -1;
        for (let i = messages.length - 1; i >= 0; i--) {
          if (messages[i]?.role === 'assistant' && (!previousAssistantId || messages[i]?.id === previousAssistantId)) { index = i; break; }
        }
        if (index < 0) return messages;
        return messages.map((message, position) => {
          if (position !== index) return message;
          const metadata = typeof message.metadata === 'object' && message.metadata !== null
            ? message.metadata as Record<string, unknown> : {};
          const custom = typeof metadata.custom === 'object' && metadata.custom !== null
            ? metadata.custom as Record<string, unknown> : {};
          return { ...message, metadata: { ...metadata, custom: { ...custom,
            voicePlayback: { interrupted: true, generationIncomplete: incomplete } } } };
        });
      }),
      });
    },
  }), [character.id, resolvedThreadId]);
  useEffect(() => realtimeVoice.changed(), [chat.status, chat.error, speechAvailable, appSettings, character]);
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
