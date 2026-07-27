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
  const hiddenRegion = useRef<HTMLDivElement>(null);
  const visibilityButton = useRef<HTMLButtonElement>(null);

  const toggleThreadList = (): void => {
    const nextCollapsed = !collapsed;
    if (
      nextCollapsed &&
      hiddenRegion.current?.contains(document.activeElement)
    ) {
      visibilityButton.current?.focus();
    }
    setCollapsed(nextCollapsed);
    writeThreadListCollapsed(window.localStorage, nextCollapsed);
  };

  return (
    <div className="chat-shell">
      <aside className="chat-sidebar" aria-label="会话侧栏">
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
          ref={hiddenRegion}
          className={`chat-thread-region${collapsed ? " is-hidden" : ""}`}
          data-hidden={collapsed}
          data-testid="thread-list-region"
          aria-hidden={collapsed}
          inert={collapsed}
        >
          <ThreadStarline hidden={collapsed} />
        </div>

        <footer className="chat-sidebar-footer">
          <TooltipIconButton
            tooltip="打开设置"
            side="top"
            className="size-8"
            data-testid="settings-launcher"
            onClick={onOpenSettings}
          >
            <SettingsIcon aria-hidden="true" />
          </TooltipIconButton>
          <TooltipIconButton
            ref={visibilityButton}
            tooltip={collapsed ? "显示会话" : "隐藏会话"}
            side="top"
            className="size-8"
            data-testid="thread-list-visibility-toggle"
            aria-controls="thread-list-region"
            aria-expanded={!collapsed}
            onClick={toggleThreadList}
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
