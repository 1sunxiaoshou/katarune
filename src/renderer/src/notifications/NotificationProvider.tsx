import { Toast } from "@base-ui/react/toast";
import {
  CheckCircle2Icon,
  CircleAlertIcon,
  InfoIcon,
  LoaderCircleIcon,
  TriangleAlertIcon,
  XIcon,
  type LucideIcon,
} from "lucide-react";

import { toastManager, type ToastNotificationData } from "./notificationCenter";
import type { NotificationLevel } from "./types";

const LEVEL_ICONS: Readonly<Record<NotificationLevel, LucideIcon>> = {
  success: CheckCircle2Icon,
  info: InfoIcon,
  warning: TriangleAlertIcon,
  error: CircleAlertIcon,
  loading: LoaderCircleIcon,
};

function NotificationViewport(): React.JSX.Element {
  const { toasts } = Toast.useToastManager<ToastNotificationData>();
  return (
    <Toast.Portal>
      <Toast.Viewport
        className="pointer-events-none fixed top-4 right-4 z-100 flex w-[min(22.5rem,calc(100vw-2rem))] flex-col gap-2 outline-none"
        data-testid="notification-viewport"
      >
        {toasts.map((toast) => {
          const level = toast.data?.level ?? "info";
          const Icon = LEVEL_ICONS[level];
          return (
            <Toast.Root
              className="pointer-events-auto rounded-xl border bg-popover text-popover-foreground shadow-lg transition-[opacity,transform] duration-200 ease-out data-[ending-style]:translate-x-2 data-[ending-style]:opacity-0 data-[limited]:hidden data-[starting-style]:-translate-y-2 data-[starting-style]:opacity-0 motion-reduce:transition-none"
              data-level={level}
              data-testid="notification-toast"
              key={toast.id}
              swipeDirection="right"
              toast={toast}
            >
              <Toast.Content className="flex items-start gap-3 p-3">
                <Icon
                  className={`mt-0.5 size-4 shrink-0 ${
                    level === "error" ? "text-destructive" : "text-muted-foreground"
                  } ${level === "loading" ? "animate-spin motion-reduce:animate-none" : ""}`}
                  aria-hidden="true"
                />
                <div className="min-w-0 flex-1">
                  <Toast.Title className="font-medium" />
                  <Toast.Description className="text-sm text-muted-foreground" />
                  {toast.actionProps !== undefined && (
                    <Toast.Action className="mt-2 inline-flex h-7 items-center justify-center rounded-md border bg-background px-2.5 text-xs font-medium outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring" />
                  )}
                </div>
                <Toast.Close
                  className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label="关闭通知"
                >
                  <XIcon className="size-4" aria-hidden="true" />
                </Toast.Close>
              </Toast.Content>
            </Toast.Root>
          );
        })}
      </Toast.Viewport>
    </Toast.Portal>
  );
}

export function NotificationProvider({
  children,
}: {
  readonly children: React.ReactNode;
}): React.JSX.Element {
  return (
    <Toast.Provider limit={3} timeout={4_000} toastManager={toastManager}>
      {children}
      <NotificationViewport />
    </Toast.Provider>
  );
}
