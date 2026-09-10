import { create } from "zustand";
import type { AvatarStatus } from "../../../shared/avatar";

export const useAvatarState = create<{
  status: AvatarStatus;
  queued: Record<string, number>;
  setStatus: (status: AvatarStatus) => void;
  setQueued: (threadId: string, count: number) => void;
}>((set) => ({
  status: { phase: "stopped", binding: null, error: null },
  queued: {},
  setStatus: (status) => set({ status }),
  setQueued: (threadId, count) =>
    set((state) => ({ queued: { ...state.queued, [threadId]: count } })),
}));
