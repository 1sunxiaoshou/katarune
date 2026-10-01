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

  const [packageRequest, setPackageRequest] = useState<{ characterId: string | null } | null>(null);
  useEffect(() => window.katarune.onOpenCharacterPackages(characterId => {
    setPackageRequest({ characterId }); setActiveView("characters");
  }), []);

  const [settingsTab, setSettingsTab] = useState<"general" | "models">("general");

  return (
    <div className="h-dvh overflow-hidden">
      <KataruneAssistantRuntimePool>
        {activeView === "chat" ? (
          <ChatPage
            onOpenCharacters={() => setActiveView("characters")}
            onOpenSettings={() => { setSettingsTab("general"); setActiveView("settings"); }}
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
            initialTab={settingsTab}
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
            packageRequest={packageRequest}
            onPackageRequestHandled={() => setPackageRequest(null)}
            onClose={() => setActiveView("chat")}
            onOpenSettings={() => { setSettingsTab("models"); setActiveView("settings"); }}
          />
        </Suspense>
      ) : null}
    </div>
  );
}
