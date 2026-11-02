import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeftIcon, ChevronRightIcon, ImageIcon, EllipsisIcon, Music2Icon, UserRoundIcon } from "lucide-react";
import bilibiliLogo from "@lobehub/icons-static-svg/icons/bilibili.svg";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "../components/ui/avatar";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Form, FormInput } from "../components/form";
import { Label } from "../components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "../components/ui/popover";
import { notify } from "../notifications";
import type { LivePlatform, LiveState } from "../../../shared/live";
import { useLiveState } from "./liveState";
import { LiveAccountLogin } from "./LiveAccountLogin";

const report = (error: unknown) => notify({ level: "error", message: error instanceof Error ? error.message : "直播连接操作失败。" });
function PlatformIcon({ platform, small = false }: { platform: LivePlatform; small?: boolean }) {
  const size = small ? "size-3.5 shrink-0" : "size-6 shrink-0";
  return platform === "douyin" ? <Music2Icon className={size} aria-hidden="true" />
    : <span className={`${size} bg-current`} aria-hidden="true" style={{ mask: `url("${bilibiliLogo}") center / contain no-repeat` }} />;
}
function RoomInfo({ state }: { state: LiveState }) {
  const [failedCover, setFailedCover] = useState("");
  const account = state.settings.connectionMode === "web" ? state.accounts?.find(account => account.platform === state.settings.platform) : undefined;
  const description = useMemo(() => {
    const document = new DOMParser().parseFromString(state.roomDescription, "text/html");
    document.querySelectorAll("script,style,template").forEach(element => element.remove());
    document.querySelectorAll("br").forEach(element => element.replaceWith("\n"));
    document.querySelectorAll("p,div,li").forEach(element => element.append("\n"));
    return document.body.textContent?.trim() || "暂无简介";
  }, [state.roomDescription]);
  const waiting = state.connection === "waiting";
  const showAccount = account && state.broadcast !== "live";
  const status = waiting ? "等待直播间" : state.connection === "reconnecting" ? "正在重新连接直播间" : state.connection === "connecting" ? "正在连接直播间……" : state.broadcast === "live" ? "直播中" : state.broadcast === "offline" ? "未开播" : "开播状态待确认";
  return <div className="live-room-details scrollbar-hidden" aria-label="直播间配置信息">
    {showAccount ? <div className="live-account-overview" data-testid="live-account-info">
      <Avatar className="size-14 shrink-0">
        {account.avatarUrl && <AvatarImage src={account.avatarUrl} alt={`${account.name}的头像`} referrerPolicy="no-referrer" />}
        <AvatarFallback><UserRoundIcon className="size-6" aria-hidden="true" /></AvatarFallback>
      </Avatar>
      <div className="min-w-0 space-y-1.5">
        <h3 className="truncate text-base font-semibold" title={account.name}>{account.name}</h3>
        <div className="live-account-meta"><span className="inline-flex items-center gap-1"><PlatformIcon platform={account.platform} small />{account.platform === "douyin" ? "抖音" : "B 站"}</span><span aria-hidden="true">·</span><span data-testid="live-room-status">{status}</span></div>
      </div>
    </div> : <div className="live-room-overview">
      <div className="live-room-cover relative aspect-video shrink-0 overflow-hidden rounded-lg bg-muted">
        {state.roomCover && failedCover !== state.roomCover ? <img src={state.roomCover} alt="直播间封面" referrerPolicy="no-referrer" className="absolute inset-0 h-full w-full object-cover" onError={() => setFailedCover(state.roomCover)} />
          : <div role="img" aria-label="暂无直播间封面" className="absolute inset-0 flex items-center justify-center text-muted-foreground"><ImageIcon className="size-6" aria-hidden="true" /></div>}
      </div>
      <div className="live-room-summary">
        <h3 className="line-clamp-2 text-sm font-semibold leading-5 wrap-anywhere" title={state.roomName}>{state.roomName || (waiting ? "等待直播间" : state.connection === "error" ? "尚未获取直播间" : "正在读取直播间")}</h3>
        <div className="live-room-meta">
          <p className="live-room-id"><span>房间号</span><span>{state.settings.webRoomId || state.roomId || "待识别"}</span></p>
          <Badge variant="secondary" className="text-muted-foreground data-[state=live]:bg-green-500/10 data-[state=live]:text-green-700 dark:data-[state=live]:text-green-400" data-state={state.broadcast} data-testid="live-room-status">{status}</Badge>
        </div>
      </div>
    </div>}
    {account && !showAccount && <p className="text-xs text-muted-foreground">{account.name}</p>}
    {!showAccount && !waiting && <section className="live-room-description" aria-labelledby="live-room-description-label"><h4 id="live-room-description-label">直播间简介</h4><p data-testid="live-room-description">{description}</p></section>}
    {waiting && <div className="grid justify-items-start gap-3"><p className="live-account-hint" role="status" data-testid="live-room-waiting">{state.settings.platform === "douyin" ? "开播后可重新检测直播间。" : "开通 B 站直播后可重新检测直播间。"}</p><Button size="sm" variant="outline" onClick={() => { void window.katarune.connectLiveRoom().then(useLiveState.getState().setState).catch(report); }}>重新检测</Button></div>}
    {state.connection === "error" && <div className="grid justify-items-start gap-2"><p className="text-xs text-destructive" role="alert">{state.error || "连接失败，请重试。"}</p><Button size="sm" variant="outline" onClick={() => { void window.katarune.connectLiveRoom().then(useLiveState.getState().setState).catch(report); }}>重新连接</Button></div>}
  </div>;
}

export function LiveConnectionPanel({ state, disabled }: { state: LiveState; disabled: boolean }) {
  const [view, setView] = useState<"choices" | "details" | "room" | "official" | "qr">("choices");
  const [menuOpen, setMenuOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [credentials, setCredentials] = useState({ appId: "", accessKey: "", accessSecret: "", identityCode: "" });
  const events = useRef<HTMLDivElement>(null);
  const navigation = useRef(0);
  const onAir = state.connection === "connected" && state.broadcast === "live";
  const savedAccount = state.settings.connectionMode === "web" && state.accounts?.some(account => account.platform === state.settings.platform);
  const panel = view === "details" ? onAir ? "events" : "info" : view === "room" ? "info" : view;
  const platform = state.settings.platform;
  const method = platform === "douyin" ? "抖音" : state.settings.connectionMode === "official" ? "B 站开放平台" : "B 站网页连接";
  useEffect(() => {
    if (state.connection === "connected" || state.connection === "waiting") setView(current => current === "qr" ? "details" : current);
  }, [state.connection]);
  useEffect(() => { if (!onAir) setView(current => current === "room" ? "details" : current); }, [onAir]);
  const lastEvent = state.events.at(-1)?.id;
  useEffect(() => { if (events.current) events.current.scrollTop = events.current.scrollHeight; }, [lastEvent, panel]);
  const perform = async (action: () => Promise<void>) => {
    if (pending) return; setPending(true);
    try { await action(); } catch (error) { report(error); } finally { setPending(false); }
  };
  const back = () => {
    navigation.current++;
    setView(view === "room" && onAir ? "details" : "choices"); setMenuOpen(false);
    setCredentials({ appId: "", accessKey: "", accessSecret: "", identityCode: "" });
  };
  const choose = (mode: "official" | "web", platform: LivePlatform) => { void perform(async () => {
    const revision = navigation.current;
    const current = state.settings.platform === platform && state.settings.connectionMode === mode;
    const next = current ? state : await window.katarune.updateLiveSettings({ ...state.settings, platform, connectionMode: mode, webRoomId: "" });
    useLiveState.getState().setState(next);
    const configured = mode === "official" ? next.officialCredentialsConfigured : next.webCredentialsConfigured || next.accounts?.some(account => account.platform === platform);
    if (revision === navigation.current) setView(configured ? "details" : mode === "official" ? "official" : "qr");
    if (configured) useLiveState.getState().setState(await window.katarune.connectLiveRoom());
  }); };
  const configureAgain = () => { setMenuOpen(false); void perform(async () => {
    const revision = navigation.current;
    useLiveState.getState().setState(await window.katarune.disconnectLiveRoom());
    if (revision === navigation.current) setView(state.settings.connectionMode === "official" ? "official" : "qr");
  }); };
  if (panel === "qr") return <Card size="sm" className="live-events live-panel" role="region" aria-label="弹幕与直播间连接">
    <LiveAccountLogin key={platform} platform={platform} onBack={back} />
  </Card>;
  return <Card size="sm" className="live-events live-panel" role="region" aria-label="弹幕与直播间连接">
    {panel !== "choices" && <CardHeader className="items-center">
      <CardTitle><h2 data-testid="live-panel-title">{panel === "events" ? "弹幕" : panel === "info" ? savedAccount && state.broadcast !== "live" ? "直播账号" : "直播间" : method}</h2></CardTitle>
      <CardAction className="row-span-1 flex items-center gap-1 self-center">
        <Button variant="ghost" size="sm" className="text-muted-foreground" aria-label={view === "room" && onAir ? "返回弹幕" : "返回连接方式"} onClick={back}><ArrowLeftIcon />返回</Button>
        {(panel === "events" || panel === "info") && <Popover open={menuOpen} onOpenChange={setMenuOpen}>
          <PopoverTrigger render={<Button variant="ghost" size="icon-sm" aria-label="连接操作" />}><EllipsisIcon /></PopoverTrigger>
          <PopoverContent align="end" className="w-auto min-w-36 gap-1">
            {panel === "events" && <Button variant="ghost" size="sm" onClick={() => { setMenuOpen(false); setView("room"); }}>直播间信息</Button>}
            <Button variant="ghost" size="sm" disabled={disabled || pending} onClick={configureAgain}>{state.settings.connectionMode === "official" ? "修改凭据" : "重新登录"}</Button>
            <Button variant="ghost" size="sm" data-testid="live-disconnect" disabled={disabled || pending} onClick={() => { setMenuOpen(false); void perform(async () => {
              useLiveState.getState().setState(await window.katarune.disconnectLiveRoom()); setView("choices");
            }); }}>断开连接</Button>
            {savedAccount && <Button variant="ghost" size="sm" data-testid="live-logout" disabled={disabled || pending} onClick={() => { setMenuOpen(false); void perform(async () => {
              useLiveState.getState().setState(await window.katarune.logoutLiveAccount(platform)); setView("choices");
            }); }}>退出账号</Button>}
          </PopoverContent>
        </Popover>}
      </CardAction>
    </CardHeader>}
    <CardContent className="flex min-h-0 flex-1 flex-col">
      <div key={panel} className="live-connection-content panel-enter">
        {panel === "choices" ? <div className="live-connection-choices scrollbar-hidden" aria-label="选择直播连接方式">
          {([{ mode: "official", platform: "bilibili", label: "B 站开放平台", id: "official" }, { mode: "web", platform: "bilibili", label: "B 站网页连接", id: "web" }, { mode: "web", platform: "douyin", label: "抖音", id: "douyin" }] as const).map(option => {
            const current = platform === option.platform && state.settings.connectionMode === option.mode;
            const account = option.mode === "web" ? state.accounts?.find(account => account.platform === option.platform) : undefined;
            const configured = option.mode === "official" ? state.officialCredentialsConfigured : !!account;
            return <Button key={option.id} variant="outline" className="live-connection-choice" disabled={pending || (disabled && (!current || !configured))} aria-current={current && configured ? "true" : undefined} data-testid={`live-connect-${option.id}`} onClick={() => choose(option.mode, option.platform)}>
              <PlatformIcon platform={option.platform} /><span className="min-w-0 flex-1 text-left"><span className="block">{option.label}</span>{account && <span className="block truncate text-xs font-normal text-muted-foreground">{account.name}</span>}</span>{current && configured && <span className="text-xs font-normal text-muted-foreground">当前</span>}<ChevronRightIcon className="size-4 text-muted-foreground" aria-hidden="true" />
            </Button>;
          })}
        </div> : panel === "official" ? <Form className="live-connect-form scrollbar-hidden" onSubmit={event => { event.preventDefault(); void perform(async () => {
          const revision = navigation.current;
          useLiveState.getState().setState(await window.katarune.setLiveCredentials(credentials));
          setCredentials({ appId: "", accessKey: "", accessSecret: "", identityCode: "" });
          if (revision === navigation.current) setView("details");
          useLiveState.getState().setState(await window.katarune.connectLiveRoom());
        }); }}>
          {([{ id: "app-id", key: "appId", label: "项目 ID" }, { id: "access-key", key: "accessKey", label: "Access Key" }, { id: "access-secret", key: "accessSecret", label: "Access Secret" }, { id: "identity-code", key: "identityCode", label: "主播身份码" }] as const).map(field =>
            <div className="live-field live-field-stacked" key={field.id}><Label htmlFor={`live-${field.id}`}>{field.label}</Label><FormInput label={field.label} id={`live-${field.id}`} required disabled={disabled || pending} type={field.key === "appId" ? "text" : "password"} autoComplete={field.key === "appId" ? "off" : "new-password"} value={credentials[field.key]} onChange={event => setCredentials({ ...credentials, [field.key]: event.target.value })} /></div>)}
          <div className="live-connect-actions"><Button type="submit" size="sm" disabled={disabled || pending}>连接</Button></div>
        </Form> : panel === "info" ? <RoomInfo state={state} /> : <div ref={events} className="live-event-list scrollbar-hidden" role="log" aria-label="直播间事件" aria-live="off">
          {!state.events.length && <div className="live-empty">等待观众互动</div>}
          {state.events.map(event => <div key={event.id} className={`live-event live-event-${event.kind}`}>
            {event.kind === "danmaku" || event.kind === "gift" ? <><b title={event.userId && event.userId !== "0" ? `用户标识：${event.userId}` : "用户身份未知"}>{event.userName || "匿名观众"}</b><span>{event.kind === "danmaku" ? event.text : `赠送 ${event.giftName} × ${event.quantity}`}</span>{event.kind === "gift" && <small>平台礼物</small>}</> : <span>{event.kind === "started" ? "直播间已开播" : event.kind === "ended" ? "直播间已下播" : "官方互动连接已结束"}</span>}
          </div>)}
        </div>}
      </div>
    </CardContent>
  </Card>;
}
