export const NOTIFICATION_LEVELS = [
  "success",
  "info",
  "warning",
  "error",
  "loading",
] as const;

export type NotificationLevel = (typeof NOTIFICATION_LEVELS)[number];

export interface NotificationAction {
  readonly label: string;
  readonly onClick: () => void;
}

export interface NotificationInput {
  readonly channel?: "toast" | undefined;
  readonly level: NotificationLevel;
  readonly message: string;
  readonly title?: string | undefined;
  readonly dedupeKey?: string | undefined;
  readonly durationMs?: number | undefined;
  readonly action?: NotificationAction | undefined;
  readonly anchor?: HTMLElement | undefined;
  readonly onClose?: (() => void) | undefined;
}
