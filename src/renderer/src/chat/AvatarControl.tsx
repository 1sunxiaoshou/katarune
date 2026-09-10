import { useAuiState } from "@assistant-ui/react";
import { useEffect, useState } from "react";
import { useCharacterSession } from "../characters/CharacterSessionProvider";
import { Button } from "../components/ui/button";
import { useAvatarState } from "./avatarState";

export function AvatarControl(): React.JSX.Element {
  const { activeCharacter } = useCharacterSession();
  const threadId = useAuiState((s) => s.threadListItem.remoteId ?? s.threadListItem.id);
  const running = useAuiState((s) => s.thread.isRunning);
  const status = useAvatarState((s) => s.status);
  const setStatus = useAvatarState((s) => s.setStatus);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bound =
    status.binding?.characterId === activeCharacter.id &&
    status.binding.threadId === threadId;
  useEffect(() => {
    let alive = true;
    const refresh = () => {
      void window.katarune
        .getAvatarStatus()
        .then((s) => {
          if (alive) setStatus(s);
        })
        .catch(() => undefined);
    };
    refresh();
    const timer = window.setInterval(refresh, 1500);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [setStatus]);
  const toggle = async () => {
    setBusy(true);
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
      setBusy(false);
    }
  };
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <Button
        data-testid="avatar-toggle"
        variant="ghost"
        size="sm"
        disabled={busy || running}
        onClick={() => void toggle()}
      >
        {busy
          ? "正在连接…"
          : bound && status.phase === "ready"
            ? "停止桌宠"
            : "连接桌宠"}
      </Button>
      {(error || status.error) && (
        <span role="alert" className="text-destructive text-xs">
          {error || status.error}
        </span>
      )}
      {!bound && status.phase === "ready" && (
        <span className="text-muted-foreground text-xs">
          桌宠连接在其他会话
        </span>
      )}
    </div>
  );
}
