import { Toast } from "@base-ui/react/toast";

import {
  clearInlineNotificationScope,
  dismissInlineNotification,
  inlineNotificationStore,
  setInlineNotification,
} from "./inlineNotificationStore";
import {
  notificationDuration,
  resolveNotificationChannel,
} from "./notificationPolicy";
import type {
  InlineNotification,
  NotificationInput,
  NotificationLevel,
} from "./types";

export interface ToastNotificationData {
  readonly level: NotificationLevel;
}

export const toastManager = Toast.createToastManager<ToastNotificationData>();

const notificationChannels = new Map<string, "toast" | "inline">();

function notificationId(input: NotificationInput): string {
  return input.dedupeKey ?? globalThis.crypto.randomUUID();
}

export function notify(input: NotificationInput): string {
  const channel = resolveNotificationChannel(input);
  const id = notificationId(input);

  if (channel === "inline") {
    const scope = input.scope;
    if (scope === undefined || scope.length === 0) {
      throw new Error("Inline notifications require a non-empty scope.");
    }
    const previous = inlineNotificationStore.getState().byScope[scope];
    if (previous !== undefined) notificationChannels.delete(previous.id);
    const notification: InlineNotification = {
      id,
      level: input.level,
      message: input.message,
      title: input.title ?? null,
      scope,
      action: input.action ?? null,
    };
    setInlineNotification(notification);
    notificationChannels.set(id, "inline");
    return id;
  }

  let toastId = id;
  const actionProps = input.action === undefined
    ? undefined
    : {
        children: input.action.label,
        onClick: () => {
          input.action?.onClick();
          toastManager.close(toastId);
        },
      };
  toastId = toastManager.add({
    id,
    type: input.level,
    ...(input.title === undefined ? {} : { title: input.title }),
    description: input.message,
    timeout: notificationDuration(input.level, input.durationMs),
    priority: input.level === "error" ? "high" : "low",
    data: { level: input.level },
    ...(actionProps === undefined ? {} : { actionProps }),
    onRemove: () => {
      notificationChannels.delete(toastId);
    },
  });
  notificationChannels.set(toastId, "toast");
  return toastId;
}

export function dismissNotification(id: string): void {
  if (notificationChannels.get(id) === "inline") {
    dismissInlineNotification(id);
  } else {
    toastManager.close(id);
  }
  notificationChannels.delete(id);
}

export function clearNotificationScope(scope: string): void {
  const notification = inlineNotificationStore.getState().byScope[scope];
  if (notification !== undefined) notificationChannels.delete(notification.id);
  clearInlineNotificationScope(scope);
}
