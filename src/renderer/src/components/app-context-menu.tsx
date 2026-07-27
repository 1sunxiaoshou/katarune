import { ContextMenu } from "@base-ui/react/context-menu";
import type { ComponentProps, ReactElement, ReactNode } from "react";

import { cn } from "@/lib/utils";

interface AppContextMenuProps {
  readonly children: ReactNode;
  readonly mergeTrigger?: boolean;
  readonly popupTestId: string;
  readonly trigger: ReactElement;
  readonly triggerClassName?: string;
}

export function AppContextMenu({
  children,
  mergeTrigger = false,
  popupTestId,
  trigger,
  triggerClassName,
}: AppContextMenuProps): React.JSX.Element {
  return (
    <ContextMenu.Root>
      {mergeTrigger ? (
        <ContextMenu.Trigger className={triggerClassName} render={trigger} />
      ) : (
        <ContextMenu.Trigger className={triggerClassName}>{trigger}</ContextMenu.Trigger>
      )}
      <ContextMenu.Portal>
        <ContextMenu.Positioner className="z-50" sideOffset={5}>
          <ContextMenu.Popup
            className="thread-context-menu"
            data-testid={popupTestId}
          >
            {children}
          </ContextMenu.Popup>
        </ContextMenu.Positioner>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

interface AppContextMenuItemProps
  extends ComponentProps<typeof ContextMenu.Item> {
  readonly danger?: boolean;
}

export function AppContextMenuItem({
  className,
  danger = false,
  ...props
}: AppContextMenuItemProps): React.JSX.Element {
  return (
    <ContextMenu.Item
      className={cn(
        "thread-context-menu-item",
        danger && "thread-context-menu-danger",
        className,
      )}
      {...props}
    />
  );
}

export function AppContextMenuSeparator(
  props: ComponentProps<typeof ContextMenu.Separator>,
): React.JSX.Element {
  return (
    <ContextMenu.Separator
      {...props}
      className={cn("thread-context-menu-separator", props.className)}
    />
  );
}
