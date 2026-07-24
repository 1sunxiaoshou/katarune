import { AssistantRuntimeProvider, useRemoteThreadListRuntime } from "@assistant-ui/react";
import { useChatRuntime } from "@assistant-ui/react-ai-sdk";
import { useEffect, useMemo, useRef, type PropsWithChildren } from "react";
import { useCharacterSession } from "./characters/CharacterSessionProvider";
import { createKataruneThreadListAdapter } from "./persistence/threadAdapters";

export function KataruneAssistantRuntimeProvider({ children }: PropsWithChildren): React.JSX.Element {
  const { activeCharacter } = useCharacterSession();
  const adapter = useMemo(
    () => createKataruneThreadListAdapter(activeCharacter.id),
    [activeCharacter.id],
  );
  const runtime = useRemoteThreadListRuntime({
    adapter,
    runtimeHook: () => useChatRuntime({ isSendDisabled: true }),
  });
  const previousCharacterId = useRef(activeCharacter.id);

  useEffect(() => {
    if (previousCharacterId.current === activeCharacter.id) return;
    previousCharacterId.current = activeCharacter.id;
    if (runtime.thread.getState().isRunning) {
      runtime.thread.cancelRun();
    }
    runtime.threads.switchToNewThread();
  }, [activeCharacter.id, runtime]);

  return <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>;
}
