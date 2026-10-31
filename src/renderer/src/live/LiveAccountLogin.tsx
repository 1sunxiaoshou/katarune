import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeftIcon, CircleCheckIcon, LoaderCircleIcon, RefreshCwIcon, ShieldAlertIcon } from "lucide-react";
import { Button } from "../components/ui/button";
import { CardAction, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { TooltipIconButton } from "../components/tooltip-icon-button";
import type { LiveLoginState, LivePlatform } from "../../../shared/live";
import { useLiveState } from "./liveState";

export function LiveAccountLogin({ platform, onBack }: { platform: LivePlatform; onBack: () => void }) {
  const [login, setLogin] = useState<LiveLoginState | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const platformName = platform === "bilibili" ? "B 站" : "抖音";
  const connect = useCallback(async () => {
    const revision = generation.current;
    setConnecting(true); setError("");
    try {
      const state = await window.katarune.connectLiveRoom();
      if (revision !== generation.current) return;
      useLiveState.getState().setState(state);
      if (state.connection !== "connected" && state.connection !== "waiting") setError(state.error ?? "暂时无法连接直播间，请重新检测。");
    } catch (cause) {
      if (revision === generation.current) setError(cause instanceof Error ? cause.message : "直播间检测失败，请重试。");
    } finally { if (revision === generation.current) setConnecting(false); }
  }, []);
  useEffect(() => {
    const revision = ++generation.current;
    let id: string | undefined, timer: ReturnType<typeof setTimeout> | undefined;
    setLogin(null); setError(""); setConnecting(false);
    const accept = async (next: LiveLoginState) => {
      if (revision !== generation.current) return;
      setLogin(next);
      if (next.status === "completed") await connect();
      else if (next.status === "waiting" || next.status === "scanned" || next.status === "verification") timer = setTimeout(() => { void poll(); }, 1800);
    };
    const poll = async () => {
      try { if (id) await accept(await window.katarune.pollLiveLogin(id)); }
      catch { if (revision === generation.current) setError("扫码状态获取失败，请刷新二维码。"); }
    };
    void window.katarune.startLiveLogin(platform).then(async next => {
      if (revision !== generation.current) { await window.katarune.cancelLiveLogin(next.id); return; }
      id = next.id; await accept(next);
    }).catch(() => { if (revision === generation.current) setError("二维码获取失败，请刷新重试。"); });
    return () => {
      ++generation.current; clearTimeout(timer);
      if (id) void window.katarune.cancelLiveLogin(id).catch(() => {});
    };
  }, [platform, attempt, connect]);
  const completed = login?.status === "completed";
  const scanned = completed || login?.status === "scanned";
  const verifying = login?.status === "verification";
  return <>
    <CardHeader className="items-center">
      <CardTitle><h2 data-testid="live-panel-title">{platform === "bilibili" ? "B 站网页连接" : "抖音"}</h2></CardTitle>
      <CardAction className="row-span-1 flex items-center gap-1 self-center">
        {!completed && <TooltipIconButton tooltip="刷新二维码" aria-label="刷新二维码" data-testid="live-login-refresh" disabled={!login && !error} onClick={() => setAttempt(value => value + 1)}><RefreshCwIcon /></TooltipIconButton>}
        <Button variant="ghost" size="sm" className="text-muted-foreground" aria-label="返回连接方式" onClick={onBack}><ArrowLeftIcon />返回</Button>
      </CardAction>
    </CardHeader>
    <CardContent className="flex min-h-0 flex-1 flex-col">
      <div className="live-account-login scrollbar-hidden" aria-label={platformName + "账号登录"}>
        {!login && !error && <><LoaderCircleIcon className="size-6 animate-spin text-muted-foreground" aria-hidden="true" /><p role="status">正在获取二维码……</p></>}
        {(scanned || verifying || login?.qrImage) && <div className="live-login-visual">
          {verifying ? <ShieldAlertIcon className="size-16 text-amber-600 dark:text-amber-400" role="img" aria-label="需要安全验证" />
            : scanned ? <CircleCheckIcon className="size-16 text-green-600 dark:text-green-400" role="img" aria-label={completed ? "登录成功" : "扫码成功"} data-testid="live-login-success" />
            : <img className="live-login-qr" src={login?.qrImage} width={160} height={160} alt={"使用" + platformName + " App 扫码登录"} />}
        </div>}
        {completed && <p className="text-foreground" role="status">{login.account?.name}，登录成功</p>}
        {connecting ? <p className="inline-flex items-center gap-2" role="status"><LoaderCircleIcon className="size-4 animate-spin" aria-hidden="true" />正在识别并连接直播间……</p>
          : login && !completed && <p role="status">{login.status === "waiting" ? `使用${platform === "bilibili" ? "哔哩哔哩" : "抖音"} App 扫码` : login.status === "scanned" ? "扫码成功，请在手机上确认登录。" : login.message}</p>}
        {error && <p className="text-destructive" role="alert">{error}</p>}
        {login?.status === "verification" && <Button type="button" variant="outline" size="sm" data-testid="live-login-verification" onClick={() => { void window.katarune.showLiveLoginVerification(login.id).catch(() => setError("平台验证窗口暂时无法打开，请刷新重试。")); }}>完成安全验证</Button>}
        {completed && !connecting && error && <Button type="button" variant="ghost" size="sm" data-testid="live-room-retry" onClick={() => { void connect(); }}>
          <RefreshCwIcon aria-hidden="true" />重新检测直播间
        </Button>}
      </div>
    </CardContent>
  </>;
}
