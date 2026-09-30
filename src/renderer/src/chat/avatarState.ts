import { create } from "zustand";
import type { AvatarStatus } from "../../../shared/avatar";

export const useAvatarState = create<{
  status: AvatarStatus;
  followEnabled: boolean;
  setFollowEnabled: (enabled: boolean) => void;
  queued: Record<string, number>;
  setStatus: (status: AvatarStatus) => void;
  setQueued: (threadId: string, count: number) => void;
}>((set) => ({
  status: { phase: "stopped", binding: null, error: null },
  followEnabled: true,
  setFollowEnabled: (followEnabled) => set({ followEnabled }),
  queued: {},
  setStatus: (status) => set({ status }),
  setQueued: (threadId, count) =>
    set((state) => ({ queued: { ...state.queued, [threadId]: count } })),
}));
