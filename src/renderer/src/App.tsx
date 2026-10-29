import { lazy, Suspense, useState, useEffect } from "react";
import { realtimeVoice } from "./speech/realtimeVoice";
import { ChatPage } from "./chat/ChatPage";
import { KataruneAssistantRuntimePool } from "./KataruneAssistantRuntimeProvider";
import { SPEECH_CONFIG_CHANGED_EVENT } from "./speech/speechAvailability";
import { useLiveState } from "./live/liveState";
import { notify } from "./notifications";
import { cancelLocalDictation } from "./speech/KataruneDictationAdapter";
import { cancelApplicationSpeech } from "./speech/KataruneSpeechSynthesisAdapter";
const LivePage = lazy(async () => ({ default: (await import("./live/LivePage")).LivePage }));

const SettingsPage = lazy(async () => {
  const settingsModule = await import("./settings/SettingsPage");
  return { default: settingsModule.SettingsPage };
});

const CharacterPage = lazy(async () => {
  const characterModule = await import("./characters/CharacterPage");
  return { default: characterModule.CharacterPage };
});

const MemoryPage = lazy(async () => {
  const module = await import("./memory/MemoryPage");
  return { default: module.MemoryPage };
});

const hasCustomTitleBar = navigator.userAgent.includes("Windows");

export function App(): React.JSX.Element {
  useEffect(() => realtimeVoice.mount(), []);
  const [activeView, setActiveView] = useState<"chat" | "settings" | "characters" | "memory" | "live">("chat");
  useEffect(() => {
    let mounted = true;
    let previousError: string | null = null;
    let previousLive = false;
    void window.katarune.getLiveState().then(state => { if (mounted) useLiveState.getState().setState(state); }).catch(() => {});
    const unsubscribe = window.katarune.onLiveChanged(state => {
      useLiveState.getState().setState(state);
      if (state.error && state.error !== previousError) notify({ level: "error", message: state.error, dedupeKey: "live-failure" });
      previousError = state.error;
      const active = ["starting", "running", "stopping"].includes(state.phase);
      if (active && !previousLive) { realtimeVoice.stop(); cancelLocalDictation(); cancelApplicationSpeech(); }
      previousLive = active;
    });
    return () => { mounted = false; unsubscribe(); };
  }, []);

  const [packageRequest, setPackageRequest] = useState<{ characterId: string | null } | null>(null);
  useEffect(() => window.katarune.onOpenCharacterPackages(characterId => {
    setPackageRequest({ characterId }); setActiveView("characters");
  }), []);

  const [settingsTab, setSettingsTab] = useState<"general" | "models">("general");

  return (
    <div className="app-shell" data-custom-titlebar={hasCustomTitleBar}>
      {hasCustomTitleBar ? (
        <header className="app-titlebar" aria-label="Katarune">
          <img src="./katarune-logo.png" alt="" draggable={false} />
          <span>Katarune</span>
        </header>
      ) : null}
      <div className="app-workspace">
        <KataruneAssistantRuntimePool>
          {activeView === "chat" ? (
            <ChatPage
              onOpenCharacters={() => setActiveView("characters")}
              onOpenSettings={() => { setSettingsTab("general"); setActiveView("settings"); }}
              onOpenMemory={() => setActiveView("memory")}
              onOpenLive={() => setActiveView("live")}
            />
          ) : null}
        </KataruneAssistantRuntimePool>
        {activeView === "live" ? <Suspense fallback={<main role="status">正在打开直播……</main>}><LivePage onClose={() => setActiveView("chat")} /></Suspense> : activeView === "settings" ? (
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
        ) : activeView === "memory" ? (
          <Suspense fallback={<main className="grid h-full place-items-center text-sm text-muted-foreground" role="status">正在打开记忆……</main>}>
            <MemoryPage onClose={() => setActiveView("chat")} />
          </Suspense>
        ) : null}
      </div>
    </div>
  );
}
