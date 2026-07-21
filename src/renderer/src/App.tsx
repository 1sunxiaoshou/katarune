import { SettingsIcon } from "lucide-react";
import { lazy, Suspense, useState } from "react";
import { Thread } from "@/components/thread";
import { TooltipIconButton } from "@/components/tooltip-icon-button";
import { applyTheme, type ThemeId } from "./theme";

const SettingsPage = lazy(async () => {
  const settingsModule = await import("./settings/SettingsPage");
  return { default: settingsModule.SettingsPage };
});

interface AppProps {
  readonly initialTheme: ThemeId;
}

export function App({ initialTheme }: AppProps): React.JSX.Element {
  const [activeView, setActiveView] = useState<"chat" | "settings">("chat");
  const [theme, setTheme] = useState<ThemeId>(initialTheme);

  const changeTheme = (nextTheme: ThemeId): void => {
    applyTheme(nextTheme);
    setTheme(nextTheme);
  };

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
          <SettingsPage theme={theme} onThemeChange={changeTheme} onClose={() => setActiveView("chat")} />
        </Suspense>
      ) : (
        <>
          <main className="h-full min-h-0 overflow-hidden" id="main-content">
            <Thread />
          </main>

          <TooltipIconButton
            tooltip="打开设置"
            className="fixed bottom-4 left-4 z-40"
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
