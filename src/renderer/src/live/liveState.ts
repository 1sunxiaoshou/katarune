import { create } from "zustand";
import { useAuiState } from "@assistant-ui/react";
import type { LiveState } from "../../../shared/live";
import type { ThreadMetadata } from "../../../shared/ipc";

export const useLiveState = create<{
  state: LiveState | null; kinds: Record<string, "chat" | "live">;
  setState: (state: LiveState) => void; remember: (threads: readonly ThreadMetadata[]) => void;
}>((set) => ({
  state: null, kinds: {}, setState: state => set(current => {
    if (current.state && current.state.revision > state.revision) return current;
    const settings = current.state && JSON.stringify(current.state.settings) === JSON.stringify(state.settings) ? current.state.settings : state.settings;
    return { state: { ...state, settings } };
  }),
  remember: threads => set(current => ({ kinds: { ...current.kinds, ...Object.fromEntries(threads.map(thread => [thread.remoteId, thread.kind])) } })),
}));
export function useThreadReadOnly() {
  const id = useAuiState(s => s.threadListItem.remoteId ?? s.threadListItem.id);
  return useLiveState(s => s.kinds[id] === "live");
}
