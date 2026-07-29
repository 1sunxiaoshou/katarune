import { createStore } from "zustand/vanilla";

import type { InlineNotification } from "./types";

interface InlineNotificationState {
  readonly byScope: Readonly<Record<string, InlineNotification>>;
}

export const inlineNotificationStore = createStore<InlineNotificationState>(() => ({
  byScope: {},
}));

export function setInlineNotification(notification: InlineNotification): void {
  inlineNotificationStore.setState((state) => ({
    byScope: {
      ...state.byScope,
      [notification.scope]: notification,
    },
  }));
}

export function dismissInlineNotification(id: string): void {
  inlineNotificationStore.setState((state) => {
    const entry = Object.entries(state.byScope).find(([, notification]) => notification.id === id);
    if (entry === undefined) return state;
    const next = { ...state.byScope };
    delete next[entry[0]];
    return { byScope: next };
  });
}

export function clearInlineNotificationScope(scope: string): void {
  inlineNotificationStore.setState((state) => {
    if (state.byScope[scope] === undefined) return state;
    const next = { ...state.byScope };
    delete next[scope];
    return { byScope: next };
  });
}

export function resetInlineNotifications(): void {
  inlineNotificationStore.setState({ byScope: {} });
}
