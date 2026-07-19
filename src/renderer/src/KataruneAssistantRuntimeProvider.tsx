import { AssistantRuntimeProvider, useRemoteThreadListRuntime } from "@assistant-ui/react";
import { useChatRuntime } from "@assistant-ui/react-ai-sdk";
import type { PropsWithChildren } from "react";
import { kataruneThreadListAdapter } from "./persistence/threadAdapters";

export function KataruneAssistantRuntimeProvider({ children }: PropsWithChildren): React.JSX.Element {
  const runtime = useRemoteThreadListRuntime({
    adapter: kataruneThreadListAdapter,
    runtimeHook: () => useChatRuntime({ isSendDisabled: true }),
  });

  return <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>;
}
