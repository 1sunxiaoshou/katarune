import { SettingsIcon, UserRoundCogIcon } from "lucide-react";
import { lazy, Suspense, useState } from "react";
import { Thread } from "@/components/thread";
import { TooltipIconButton } from "@/components/tooltip-icon-button";

const SettingsPage = lazy(async () => {
  const settingsModule = await import("./settings/SettingsPage");
  return { default: settingsModule.SettingsPage };
});

const CharacterPage = lazy(async () => {
  const characterModule = await import("./characters/CharacterPage");
  return { default: characterModule.CharacterPage };
});

export function App(): React.JSX.Element {
  const [activeView, setActiveView] = useState<"chat" | "settings" | "characters">("chat");

  return (
    <div className="h-dvh overflow-hidden">
      {activeView === "settings" ? (
        <Suspense
          fallback={
            <main className="grid h-full place-items-center text-sm text-muted-foreground" role="status">
              正在打开设置……
            </main>
          }
        >
          <SettingsPage onClose={() => setActiveView("chat")} />
        </Suspense>
      ) : activeView === "characters" ? (
        <Suspense
          fallback={
            <main className="grid h-full place-items-center text-sm text-muted-foreground" role="status">
              正在打开角色图鉴……
            </main>
          }
        >
          <CharacterPage
            onClose={() => setActiveView("chat")}
            onOpenSettings={() => setActiveView("settings")}
          />
        </Suspense>
      ) : (
        <>
          <main className="h-full min-h-0 overflow-hidden" id="main-content">
            <Thread />
          </main>

          <TooltipIconButton
            tooltip="角色管理"
            className="fixed bottom-14 left-4 z-40 size-8"
            data-testid="character-launcher"
            onClick={() => setActiveView("characters")}
          >
            <UserRoundCogIcon aria-hidden="true" />
          </TooltipIconButton>

          <TooltipIconButton
            tooltip="打开设置"
            className="fixed bottom-4 left-4 z-40 size-8"
            data-testid="settings-launcher"
            onClick={() => setActiveView("settings")}
          >
            <SettingsIcon aria-hidden="true" />
          </TooltipIconButton>
        </>
      )}
    </div>
  );
}
