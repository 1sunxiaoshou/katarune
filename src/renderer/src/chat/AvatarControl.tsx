import { useAui, useAuiState } from "@assistant-ui/react";
import { useEffect, useRef, useState } from "react";
import { PawPrintIcon, CircleAlertIcon, LoaderCircleIcon } from "lucide-react";
import { useCharacterSession } from "../characters/CharacterSessionProvider";
import { TooltipIconButton } from "../components/tooltip-icon-button";
import { notify } from "../notifications/notificationCenter";
import { useAvatarState } from "./avatarState";
import { useApplicationSettings } from "../settings/ApplicationSettingsProvider";
import { useLiveState, useThreadReadOnly } from "../live/liveState";

// Mounted once for the active character, including while settings or the
// minimized chat window are shown. The capsule never owns a second runtime.
export function AvatarTextInputBridge(): null {
  const aui = useAui();
  const { activeCharacter } = useCharacterSession();
  const { appSettings } = useApplicationSettings();
  useEffect(() => window.katarune.onAvatarTextInput(request => {
    const avatar = useAvatarState.getState().status;
    const item = aui.threadListItem().getState();
    const thread = aui.thread();
    if (avatar.phase !== "ready"
      || avatar.binding?.characterId !== request.binding.characterId
      || avatar.binding.threadId !== request.binding.threadId
      || activeCharacter.id !== request.binding.characterId
      || (item.remoteId ?? item.id) !== request.binding.threadId)
      return "会话已切换，请重新输入。";
    if (thread.getState().isDisabled || thread.getState().isLoading)
      return "会话正在准备，请稍后重试。";
    if (activeCharacter.modelConfigId === null && appSettings.defaultLanguageModelConfigId === null)
      return "请先在设置中选择对话模型。";
    thread.append({ role: "user", content: [{ type: "text", text: request.text }] });
    return null;
  }), [aui, activeCharacter, appSettings.defaultLanguageModelConfigId]);
  return null;
}

export function AvatarSessionBinding(): null {
  const { activeCharacter } = useCharacterSession();
  const threadId = useAuiState(s => s.threadListItem.remoteId ?? s.threadListItem.id);
  const status = useAvatarState(s => s.status);
  const followEnabled = useAvatarState(s => s.followEnabled);
  const live = useLiveState(s => !!s.state && ["starting", "running", "stopping"].includes(s.state.phase));
  const liveThread = useLiveState(s => s.kinds[threadId] === "live");
  const wasLive = useRef(false), restoredSelection = useRef<string | null>(null);
  const enabled = status.phase === "ready" || status.phase === "starting" || status.phase === "switching";
  useEffect(() => {
    const selection = `${activeCharacter.id}:${threadId}`;
    if (status.live || live) { wasLive.current = true; return; }
    if (wasLive.current) { wasLive.current = false; restoredSelection.current = selection; }
    if (restoredSelection.current === selection || liveThread) return;
    restoredSelection.current = null;
    if (!followEnabled || !useAvatarState.getState().followEnabled || !enabled || (status.binding?.characterId === activeCharacter.id && status.binding.threadId === threadId)) return;
    let cancelled = false;
    void window.katarune.startAvatar({ characterId: activeCharacter.id, threadId }).catch(error => {
      if (!cancelled) notify({ level: "error", message: error instanceof Error ? error.message : "桌宠会话切换失败。" });
    });
    return () => { cancelled = true; };
  }, [activeCharacter.id, threadId, enabled, followEnabled, status.binding, status.live, live, liveThread]);
  return null;
}

export function AvatarControl(): React.JSX.Element {
  const readOnly = useThreadReadOnly();
  const { activeCharacter } = useCharacterSession();
  const threadId = useAuiState(s => s.threadListItem.remoteId ?? s.threadListItem.id);
  const status = useAvatarState(s => s.status);
  const [operation, setOperation] = useState<"connecting" | "stopping" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  const operationVersion = useRef(0);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const enabled = status.phase === "ready" || status.phase === "starting" || status.phase === "switching";
  const disabled = operation === "stopping" || (operation === "connecting" && !enabled) || (readOnly && !enabled);
  const toggle = async () => {
    if (status.live) return;
    if (disabled) return;
    const version = ++operationVersion.current;
    useAvatarState.getState().setFollowEnabled(!enabled);
    setOperation(enabled ? "stopping" : "connecting");
    setError(null);
    try {
      if (enabled) await window.katarune.stopAvatar();
      else {
        await window.katarune.startAvatar({ characterId: activeCharacter.id, threadId });
      }
    } catch (failure) {
      if (alive.current && operationVersion.current === version)
        setError(failure instanceof Error ? failure.message : "桌宠连接失败。");
    } finally { if (alive.current && operationVersion.current === version) setOperation(null); }
  };
  const pending = operation !== null || status.phase === "starting" || status.phase === "switching";
  const failure = error || status.error;
  const state = pending ? "pending" : failure ? "error" : enabled ? "connected" : "disconnected";
  const label = status.live ? "直播正在使用角色" : enabled ? "停止桌宠" : readOnly ? "直播记录仅供查看" : failure ? "重试桌宠连接" : "开启桌宠";
  const tooltip = [status.phase === "switching" ? "切换会话中 · 停止桌宠" : label, failure].filter(Boolean).join("；");
  return (
    <TooltipIconButton
      data-testid="avatar-toggle" data-state={state} tooltip={tooltip} aria-label={label}
      side="top" aria-disabled={disabled} aria-busy={pending}
      className={`relative size-8 ${enabled ? "bg-accent text-accent-foreground" : ""} ${failure && !pending ? "text-destructive" : ""} ${disabled ? "cursor-default opacity-50 active:scale-100" : ""}`}
      onClick={() => void toggle()}
    >
      {pending ? <LoaderCircleIcon aria-hidden="true" className="animate-spin motion-reduce:animate-none" /> : (
        <>
          <PawPrintIcon aria-hidden="true" />
          {(failure || enabled) && <span aria-hidden="true" className="absolute right-0 bottom-0 rounded-full bg-background p-px [&>svg]:size-2.5">
            {failure ? <CircleAlertIcon /> : <span className="block size-1.5 rounded-full bg-green-500" />}
          </span>}
        </>
      )}
      {failure && <span className="sr-only" role="alert">{failure}</span>}
    </TooltipIconButton>
  );
}
