import { lazy, Suspense, useState, useEffect } from "react";
import { realtimeVoice } from "./speech/realtimeVoice";
import { ChatPage } from "./chat/ChatPage";
import { KataruneAssistantRuntimePool } from "./KataruneAssistantRuntimeProvider";
import { SPEECH_CONFIG_CHANGED_EVENT } from "./speech/speechAvailability";

const SettingsPage = lazy(async () => {
  const settingsModule = await import("./settings/SettingsPage");
  return { default: settingsModule.SettingsPage };
});

const CharacterPage = lazy(async () => {
  const characterModule = await import("./characters/CharacterPage");
  return { default: characterModule.CharacterPage };
});

export function App(): React.JSX.Element {
  useEffect(() => realtimeVoice.mount(), []);
  const [activeView, setActiveView] = useState<"chat" | "settings" | "characters">("chat");

  return (
    <div className="h-dvh overflow-hidden">
      <KataruneAssistantRuntimePool>
        {activeView === "chat" ? (
          <ChatPage
            onOpenCharacters={() => setActiveView("characters")}
            onOpenSettings={() => setActiveView("settings")}
          />
        ) : null}
      </KataruneAssistantRuntimePool>
      {activeView === "settings" ? (
        <Suspense
          fallback={
            <main className="grid h-full place-items-center text-sm text-muted-foreground" role="status">
              正在打开设置……
            </main>
          }
        >
          <SettingsPage
            onClose={() => {
              window.dispatchEvent(new Event(SPEECH_CONFIG_CHANGED_EVENT));
              setActiveView("chat");
            }}
          />
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
      ) : null}
    </div>
  );
}
