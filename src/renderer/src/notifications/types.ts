export const NOTIFICATION_LEVELS = [
  "success",
  "info",
  "warning",
  "error",
  "loading",
] as const;

export type NotificationLevel = (typeof NOTIFICATION_LEVELS)[number];
export type NotificationChannel = "auto" | "toast" | "inline";

export interface NotificationAction {
  readonly label: string;
  readonly onClick: () => void;
}

interface NotificationInputBase {
  readonly level: NotificationLevel;
  readonly message: string;
  readonly title?: string | undefined;
  readonly dedupeKey?: string | undefined;
  readonly durationMs?: number | undefined;
  readonly action?: NotificationAction | undefined;
}

export type NotificationInput =
  | (NotificationInputBase & {
      readonly channel?: "auto" | "toast" | undefined;
      readonly scope?: string | undefined;
    })
  | (NotificationInputBase & {
      readonly channel: "inline";
      readonly scope: string;
    });

export interface InlineNotification {
  readonly id: string;
  readonly level: NotificationLevel;
  readonly message: string;
  readonly title: string | null;
  readonly scope: string;
  readonly action: NotificationAction | null;
}
