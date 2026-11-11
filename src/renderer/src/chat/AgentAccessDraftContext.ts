import { createContext, useContext } from "react";
import { createStore } from "zustand/vanilla";
import type { AgentAccessMode } from "../../../shared/agentTools";

export function createAgentAccessDraftStore() {
  return createStore<{
    modes: ReadonlyMap<string, AgentAccessMode>;
    setMode: (threadId: string, mode: AgentAccessMode) => void;
    clear: (threadId: string) => void;
  }>((set) => ({
    modes: new Map(),
    setMode: (threadId, mode) => set(({ modes }) => ({ modes: new Map(modes).set(threadId, mode) })),
    clear: (threadId) => set(({ modes }) => {
      const next = new Map(modes);
      next.delete(threadId);
      return { modes: next };
    }),
  }));
}

export type AgentAccessDraftStore = ReturnType<typeof createAgentAccessDraftStore>;
export const AgentAccessDraftContext = createContext<AgentAccessDraftStore | null>(null);

export function useAgentAccessDrafts(): AgentAccessDraftStore {
  const drafts = useContext(AgentAccessDraftContext);
  if (!drafts) throw new Error("AgentAccessDraftContext is missing.");
  return drafts;
}
