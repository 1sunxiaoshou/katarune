import { Toast } from "@base-ui/react/toast";

import { notificationDuration } from "./notificationPolicy";
import type {
  NotificationInput,
  NotificationLevel,
} from "./types";

export interface ToastNotificationData {
  readonly level: NotificationLevel;
}

export const toastManager = Toast.createToastManager<ToastNotificationData>();

let activeFieldNotification: string | null = null;

function notificationId(input: NotificationInput): string {
  return input.dedupeKey ?? globalThis.crypto.randomUUID();
}

export function notify(input: NotificationInput): string {
  const id = notificationId(input);
  if (input.anchor) {
    if (activeFieldNotification && activeFieldNotification !== id) toastManager.close(activeFieldNotification);
    activeFieldNotification = id;
  }

  let toastId = id;
  const incidentId = input.message.match(/故障编号：([0-9a-f-]{36})/)?.[1];
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
    ...(input.anchor ? { positionerProps: { anchor: input.anchor, side: "bottom", align: "center", sideOffset: 4, positionMethod: "fixed" } } : {}),
    ...(actionProps === undefined
      ? incidentId ? { actionProps: { children: "复制故障编号", onClick: () => { void navigator.clipboard.writeText(incidentId).catch(() => {}); } } } : {}
      : { actionProps }),
    onClose: () => {
      if (activeFieldNotification === toastId) activeFieldNotification = null;
      input.onClose?.();
    },
  });
  return toastId;
}

export function dismissNotification(id: string): void {
  toastManager.close(id);
  if (activeFieldNotification === id) activeFieldNotification = null;
}
