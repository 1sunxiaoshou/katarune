import { AvatarControl } from "./AvatarControl";
import { EyeIcon, EyeOffIcon, SettingsIcon } from "lucide-react";
import { useRef, useState } from "react";

import { Thread } from "@/components/thread";
import { TooltipIconButton } from "@/components/tooltip-icon-button";
import { CharacterCard } from "../characters/CharacterCard";
import { useCharacterSession } from "../characters/CharacterSessionProvider";
import {
  readThreadListCollapsed,
  writeThreadListCollapsed,
} from "./threadSidebarState";
import { ThreadStarline } from "./ThreadStarline";

interface ChatPageProps {
  readonly onOpenCharacters: () => void;
  readonly onOpenSettings: () => void;
}

export function ChatPage({
  onOpenCharacters,
  onOpenSettings,
}: ChatPageProps): React.JSX.Element {
  const { activeCharacter } = useCharacterSession();
  const [collapsed, setCollapsed] = useState(() =>
    readThreadListCollapsed(window.localStorage),
  );
  const hiddenContent = useRef<HTMLDivElement>(null);
  const visibilityButton = useRef<HTMLButtonElement>(null);

  const toggleSidebarContent = (): void => {
    const nextCollapsed = !collapsed;
    if (
      nextCollapsed &&
      hiddenContent.current?.contains(document.activeElement)
    ) {
      visibilityButton.current?.focus();
    }
    setCollapsed(nextCollapsed);
    writeThreadListCollapsed(window.localStorage, nextCollapsed);
  };

  return (
    <div className="chat-shell">
      <aside
        className={`chat-sidebar${collapsed ? " is-collapsed" : ""}`}
        data-collapsed={collapsed}
        aria-label="会话侧栏"
      >
        <div
          ref={hiddenContent}
          id="chat-sidebar-content"
          className={`chat-sidebar-content${collapsed ? " is-hidden" : ""}`}
          data-hidden={collapsed}
          data-testid="chat-sidebar-content"
          aria-hidden={collapsed}
          inert={collapsed}
        >
          <div
            className="chat-character-entry"
            data-testid="character-launcher-container"
          >
            <CharacterCard
              character={activeCharacter}
              selected
              testId="character-launcher"
              onSelect={onOpenCharacters}
            />
          </div>

          <div
            className="chat-thread-region"
            data-hidden={collapsed}
            data-testid="thread-list-region"
          >
            <ThreadStarline hidden={collapsed} />
          </div>
        </div>

        <footer className="chat-sidebar-footer">
          <TooltipIconButton
            tooltip="设置"
            side="top"
            className="size-8"
            data-testid="settings-launcher"
            onClick={onOpenSettings}
          >
            <SettingsIcon aria-hidden="true" />
          </TooltipIconButton>
          <AvatarControl />
          <TooltipIconButton
            ref={visibilityButton}
            tooltip={collapsed ? "显示侧栏" : "隐藏侧栏"}
            side="top"
            className="size-8"
            data-testid="thread-list-visibility-toggle"
            aria-controls="chat-sidebar-content"
            aria-expanded={!collapsed}
            onClick={toggleSidebarContent}
          >
            {collapsed ? (
              <EyeIcon aria-hidden="true" />
            ) : (
              <EyeOffIcon aria-hidden="true" />
            )}
          </TooltipIconButton>
        </footer>
      </aside>

      <main className="chat-main" id="main-content">
        <Thread />
      </main>
    </div>
  );
}
