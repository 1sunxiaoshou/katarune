import type { NotificationLevel } from "./types";

const DEFAULT_DURATIONS: Readonly<Record<NotificationLevel, number>> = {
  success: 3_000,
  info: 4_000,
  warning: 6_000,
  error: 0,
  loading: 0,
};

export function notificationDuration(
  level: NotificationLevel,
  durationMs?: number,
): number {
  return durationMs ?? DEFAULT_DURATIONS[level];
}
