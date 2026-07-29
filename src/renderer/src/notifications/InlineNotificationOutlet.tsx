import {
  CheckCircle2Icon,
  CircleAlertIcon,
  InfoIcon,
  LoaderCircleIcon,
  TriangleAlertIcon,
  XIcon,
  type LucideIcon,
} from "lucide-react";
import { useStore } from "zustand";

import { Button } from "@/components/ui/button";
import { dismissNotification } from "./notificationCenter";
import { inlineNotificationStore } from "./inlineNotificationStore";
import type { NotificationLevel } from "./types";

const LEVEL_ICONS: Readonly<Record<NotificationLevel, LucideIcon>> = {
  success: CheckCircle2Icon,
  info: InfoIcon,
  warning: TriangleAlertIcon,
  error: CircleAlertIcon,
  loading: LoaderCircleIcon,
};

export function InlineNotificationOutlet({
  scope,
  className = "",
}: {
  readonly scope: string;
  readonly className?: string | undefined;
}): React.JSX.Element | null {
  const notification = useStore(
    inlineNotificationStore,
    (state) => state.byScope[scope] ?? null,
  );
  if (notification === null) return null;

  const Icon = LEVEL_ICONS[notification.level];
  return (
    <div
      className={`flex min-w-0 items-start gap-2 text-sm ${
        notification.level === "error" ? "text-destructive" : "text-muted-foreground"
      } ${className}`}
      data-level={notification.level}
      data-notification-scope={scope}
      role={notification.level === "error" ? "alert" : "status"}
    >
      <Icon
        className={`mt-0.5 size-4 shrink-0 ${
          notification.level === "loading" ? "animate-spin motion-reduce:animate-none" : ""
        }`}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        {notification.title !== null && <p className="font-medium text-foreground">{notification.title}</p>}
        <p>{notification.message}</p>
        {notification.action !== null && (
          <Button
            className="mt-2 h-7"
            size="sm"
            variant="outline"
            onClick={notification.action.onClick}
          >
            {notification.action.label}
          </Button>
        )}
      </div>
      <Button
        className="size-7 shrink-0"
        size="icon"
        variant="ghost"
        aria-label="关闭提示"
        onClick={() => dismissNotification(notification.id)}
      >
        <XIcon aria-hidden="true" />
      </Button>
    </div>
  );
}
