import { useAuiState } from "@assistant-ui/react";
import { useState } from "react";
import { ArrowLeftRightIcon, PawPrintIcon, CircleAlertIcon, LoaderCircleIcon } from "lucide-react";
import { useCharacterSession } from "../characters/CharacterSessionProvider";
import { TooltipIconButton } from "../components/tooltip-icon-button";
import { useAvatarState } from "./avatarState";

export function AvatarControl(): React.JSX.Element {
  const { activeCharacter } = useCharacterSession();
  const threadId = useAuiState((s) => s.threadListItem.remoteId ?? s.threadListItem.id);
  const running = useAuiState((s) => s.thread.isRunning);
  const status = useAvatarState((s) => s.status);
  const setStatus = useAvatarState((s) => s.setStatus);
  const [operation, setOperation] = useState<"connecting" | "stopping" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const bound =
    status.binding?.characterId === activeCharacter.id &&
    status.binding.threadId === threadId;
  const toggle = async () => {
    if (operation || status.phase === "starting" || running) return;
    setOperation(bound && status.phase === "ready" ? "stopping" : "connecting");
    setError(null);
    try {
      if (bound && status.phase === "ready")
        setStatus(await window.katarune.stopAvatar());
      else {
        setStatus(
          await window.katarune.startAvatar({
            characterId: activeCharacter.id,
            threadId,
          }),
        );
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "桌宠连接失败。");
    } finally {
      setOperation(null);
    }
  };
  const pending = operation !== null || status.phase === "starting";
  const connected = bound && status.phase === "ready";
  const elsewhere = !bound && status.phase === "ready";
  const failure = error || status.error;
  const state = pending ? "pending" : failure ? "error" : connected ? "connected" : elsewhere ? "elsewhere" : "disconnected";
  const label = pending
    ? operation === "stopping" ? "正在停止桌宠…" : "正在连接桌宠…"
    : failure ? connected ? "桌宠操作失败，点击停止桌宠" : "桌宠连接失败，点击重试"
    : connected ? "停止桌宠"
    : elsewhere ? "桌宠连接在其他会话，点击连接到当前会话"
    : "连接桌宠";
  const tooltip = [label, failure, running ? "当前回复生成中，暂时无法切换连接" : null].filter(Boolean).join("；");

  return (
    <TooltipIconButton
      data-testid="avatar-toggle"
      data-state={state}
      tooltip={tooltip}
      aria-label={label}
      side="top"
      aria-disabled={pending || running}
      aria-busy={pending}
      className={`relative size-8 ${connected ? "bg-accent text-accent-foreground" : ""} ${failure && !pending ? "text-destructive" : ""} ${pending || running ? "cursor-default opacity-50 active:scale-100" : ""}`}
      onClick={() => void toggle()}
    >
      {pending ? (
        <LoaderCircleIcon aria-hidden="true" className="animate-spin motion-reduce:animate-none" />
      ) : (
        <>
          <PawPrintIcon aria-hidden="true" />
          {(failure || connected || elsewhere) && (
            <span aria-hidden="true" className="absolute right-0 bottom-0 rounded-full bg-background p-px [&>svg]:size-2.5">
              {failure ? <CircleAlertIcon /> : connected ? <span className="block size-1.5 rounded-full bg-green-500" /> : <ArrowLeftRightIcon />}
            </span>
          )}
        </>
      )}
      {failure && <span className="sr-only" role="alert">{failure}</span>}
    </TooltipIconButton>
  );
}
