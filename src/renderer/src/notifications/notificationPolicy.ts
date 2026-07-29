import type {
  NotificationChannel,
  NotificationInput,
  NotificationLevel,
} from "./types";

const DEFAULT_DURATIONS: Readonly<Record<NotificationLevel, number>> = {
  success: 3_000,
  info: 4_000,
  warning: 6_000,
  error: 0,
  loading: 0,
};

export function resolveNotificationChannel(
  input: NotificationInput,
): Exclude<NotificationChannel, "auto"> {
  if (input.channel === "inline" || input.channel === "toast") return input.channel;
  if (
    input.scope !== undefined &&
    (input.level === "warning" || input.level === "error" || input.level === "loading")
  ) {
    return "inline";
  }
  return "toast";
}

export function notificationDuration(
  level: NotificationLevel,
  durationMs?: number,
): number {
  return durationMs ?? DEFAULT_DURATIONS[level];
}
