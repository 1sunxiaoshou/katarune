import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ImageIcon, ArrowLeftIcon, ChevronRightIcon, ChevronUpIcon, CopyIcon, Settings2Icon, Volume2Icon, VolumeXIcon, LoaderCircleIcon } from "lucide-react";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "../components/ui/avatar";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleIndicator, CollapsibleTrigger } from "../components/ui/collapsible";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { OptionSelect } from "../components/ui/option-select";
import { Popover, PopoverContent, PopoverTrigger } from "../components/ui/popover";
import { Switch } from "../components/ui/switch";
import { Textarea } from "../components/ui/textarea";
import { TooltipIconButton } from "../components/tooltip-icon-button";
import { PageLoading } from "../components/page-loading";
import { useCharacterSession } from "../characters/CharacterSessionProvider";
import { notify } from "../notifications";
import { assetUrl, type Character } from "../../../shared/ipc";
import { DEFAULT_LIVE_SETTINGS, type LiveSettings } from "../../../shared/live";
import { useLiveState } from "./liveState";
import { LivePreviewPlayer } from "./livePreviewPlayer";
import "./live.css";

const report = (error: unknown) => notify({ level: "error", message: error instanceof Error ? error.message : "直播操作失败。" });
function Field({ id, label, stacked = false, children }: { id: string; label: string; stacked?: boolean; children: ReactNode }) {
  return <div className={`live-field${stacked ? " live-field-stacked" : ""}`}>
    <Label htmlFor={id}>{label}</Label>
    {children}
  </div>;
}

function SettingsSection({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return <Collapsible className="border-t pt-3">
    <CollapsibleTrigger id={id} render={<Button variant="ghost" className="w-full justify-between" />}>
      {title}<CollapsibleIndicator />
    </CollapsibleTrigger>
    <CollapsibleContent><div className="grid gap-4 pt-4">{children}</div></CollapsibleContent>
  </Collapsible>;
}

function RoomCover({ src }: { src: string }) {
  const [failed, setFailed] = useState("");
  return <div className="live-room-cover relative aspect-video shrink-0 overflow-hidden rounded-lg bg-muted">
    {src && failed !== src ? <img src={src} alt="直播间封面" referrerPolicy="no-referrer" className="absolute inset-0 h-full w-full object-cover" onError={() => setFailed(src)} />
      : <div role="img" aria-label="暂无直播间封面" className="absolute inset-0 flex items-center justify-center text-muted-foreground"><ImageIcon className="size-6" aria-hidden="true" /></div>}
  </div>;
}
function plainRoomDescription(html: string) {
  const document = new DOMParser().parseFromString(html, "text/html");
  document.querySelectorAll("script,style,template").forEach(element => element.remove());
  document.querySelectorAll("br").forEach(element => element.replaceWith("\n"));
  document.querySelectorAll("p,div,li").forEach(element => element.append("\n"));
  return document.body.textContent?.trim() || "暂无简介";
}

export function LivePage({ onClose }: { onClose: () => void }) {
  const state = useLiveState(s => s.state);
  const { activeCharacter } = useCharacterSession();
  const [characters, setCharacters] = useState<Character[]>([]);
  const [pickRole, setPickRole] = useState(false);
  const [connectionView, setConnectionView] = useState<"default" | "choices" | "form" | "info">("default");
  const [credentials, setCredentials] = useState({ appId: "", accessKey: "", accessSecret: "", identityCode: "" });
  const [webCookie, setWebCookie] = useState("");
  const [draft, setDraft] = useState<LiveSettings>(state?.settings ?? DEFAULT_LIVE_SETTINGS);
  const [pending, setPending] = useState(false);
  const [previewReady, setPreviewReady] = useState(false);
  const video = useRef<HTMLVideoElement>(null), events = useRef<HTMLDivElement>(null);
  const preview = useRef<LivePreviewPlayer | null>(null);
  const monitor = useRef(state?.monitor ?? false); monitor.current = state?.monitor ?? false;
  const initialized = useRef(false);
  const connectionChecked = useRef(false);
  useEffect(() => {
    if (!state || connectionChecked.current) return;
    connectionChecked.current = true;
    if (state.credentialsConfigured && (state.phase === "stopped" || state.phase === "error")) void window.katarune.connectLiveRoom().then(useLiveState.getState().setState).catch(report);
  }, [state]);
  const savedSettings = state?.settings;
  const roomDescription = useMemo(() => plainRoomDescription(state?.roomDescription ?? ""), [state?.roomDescription]);
  useEffect(() => { if (savedSettings) setDraft(savedSettings); }, [savedSettings]);
  useEffect(() => { void window.katarune.listCharacters().then(result => setCharacters(result.characters)).catch(report); }, []);
  useEffect(() => {
    if (!state || state.settings.characterId || initialized.current) return;
    initialized.current = true;
    void window.katarune.updateLiveSettings({ ...state.settings, characterId: activeCharacter.id }).then(useLiveState.getState().setState).catch(report);
  }, [state, activeCharacter.id]);
  useEffect(() => {
    if (!video.current || state?.phase !== "running") return;
    let disposed = false, reported = false;
    const playbackError = (error: unknown) => {
      if (!disposed && !(error instanceof DOMException && error.name === "AbortError") && !reported) { reported = true; report(error); }
    };
    const player = new LivePreviewPlayer(video.current, playbackError);
    preview.current = player; player.setMonitor(monitor.current);
    const unsubscribe = window.katarune.onLivePreview(async frame => {
      if (disposed || document.hidden) return;
      try { await player.append(frame); }
      catch (error) { playbackError(error); }
    });
    const visibility = () => { if (document.hidden) { player.close(); setPreviewReady(false); } };
    document.addEventListener("visibilitychange", visibility);
    return () => { disposed = true; unsubscribe(); player.close(); preview.current = null; document.removeEventListener("visibilitychange", visibility); };
  }, [state?.phase]);
  useEffect(() => { preview.current?.setMonitor(state?.monitor ?? false); }, [state?.monitor]);
  useEffect(() => { if (state?.phase !== "running") setPreviewReady(false); }, [state?.phase]);
  const lastEvent = state?.events.at(-1)?.id;
  useEffect(() => { if (events.current) events.current.scrollTop = events.current.scrollHeight; }, [lastEvent, state?.broadcast, state?.connection, connectionView]);
  if (!state) return <PageLoading message="正在读取直播配置……" />;
  const active = ["starting", "running", "stopping"].includes(state.phase);
  const transitioning = state.phase === "starting" || state.phase === "stopping";
  const character = characters.find(item => item.id === state.settings.characterId) ?? activeCharacter;
  const portraitId = character.packageThumbnailAssetId ?? character.packagePortraitAssetId;
  const save = async (next = draft) => {
    try { useLiveState.getState().setState(await window.katarune.updateLiveSettings(next)); }
    catch (error) { setDraft(state.settings); report(error); }
  };
  const change = <K extends keyof LiveSettings>(key: K, value: LiveSettings[K], immediate = false) => {
    const next = { ...draft, [key]: value }; setDraft(next); if (immediate) void save(next);
  };
  const perform = async (action: () => Promise<unknown>) => {
    if (pending) return; setPending(true);
    try { await action(); } catch (error) { report(error); } finally { setPending(false); }
  };
  const configured = state.credentialsConfigured;
  const connectionPanel = connectionView === "default" ? configured ? "events" : "choices" : connectionView;
  const onAir = state.connection === "connected" && state.broadcast === "live";
  const roomStatus = state.connection === "disconnected" ? "已断开连接" : state.connection === "error" ? "连接失败，请重试" : state.connection === "connecting" ? "正在检测直播间……" : state.connection === "reconnecting" ? "正在重新连接直播间……" : state.broadcast === "offline" ? "未开播" : "开播状态待确认";
  const connectionModeLabel = draft.connectionMode === "official" ? "官方开放平台" : "网页直连";
  const chooseConnection = (mode: LiveSettings["connectionMode"]) => {
    const next = { ...draft, connectionMode: mode };
    void perform(async () => {
      const updated = await window.katarune.updateLiveSettings(next);
      useLiveState.getState().setState(updated); setDraft(updated.settings);
      setConnectionView("form");
    });
  };
  const connectionLabel = { disconnected: "未连接", connecting: "连接中", connected: "已连接", reconnecting: "重连中", error: "连接失败" }[state.connection];
  return <main className="live-page page-frame" data-testid="live-page">
    <header className="live-header"><TooltipIconButton tooltip="返回对话" aria-label="返回对话" onClick={onClose}><ArrowLeftIcon /></TooltipIconButton><h1>直播</h1></header>
    <div className="live-workspace">
      <section className="live-preview dark bg-background text-muted-foreground" aria-label="直播画面预览">
        <video ref={video} aria-label="当前直播画面" playsInline disablePictureInPicture
          onPlaying={() => setPreviewReady(true)} className={`live-preview-frame${previewReady ? " is-ready" : ""}`} />
        {!previewReady && <div className="live-preview-placeholder">
          {character.packageThumbnailAssetId && <img src={assetUrl(character.packageThumbnailAssetId)} alt="" onError={event => { event.currentTarget.style.display = "none"; }} />}
          <span>{state.phase === "starting" ? "正在准备直播画面……" : "启动后预览直播画面"}</span>
        </div>}
        <TooltipIconButton variant="secondary" className="live-monitor" tooltip={state.monitor ? "关闭本机监听" : "开启本机监听"} aria-pressed={state.monitor}
          onClick={() => { void window.katarune.setLiveMonitor({ enabled: !state.monitor }).catch(report); }}>
          {state.monitor ? <Volume2Icon /> : <VolumeXIcon />}
        </TooltipIconButton>
      </section>
      <Card size="sm" className="live-events live-panel" role="region" aria-label="弹幕与直播间连接">
        <CardHeader className="items-center">
          <CardTitle><h2>弹幕</h2></CardTitle>
          <CardAction className="row-span-1 self-center">{configured ? <Button variant="ghost" size="sm" className="live-connection text-muted-foreground" data-state={state.connection} onClick={() => setConnectionView(connectionPanel === "events" ? "info" : "default")} aria-label="管理直播间连接" aria-expanded={connectionPanel !== "events"}>
            <span aria-hidden="true" className={`size-1.5 rounded-full ${state.connection === "connected" ? "bg-green-500" : state.connection === "error" ? "bg-destructive" : "bg-muted-foreground"}`} />{connectionLabel}<Settings2Icon aria-hidden="true" />
          </Button> : <span className="inline-flex h-7 items-center gap-1.5 text-xs text-muted-foreground" role="status"><span aria-hidden="true" className={`size-1.5 rounded-full ${state.connection === "error" ? "bg-destructive" : "bg-muted-foreground"}`} />{connectionLabel}</span>}</CardAction>
        </CardHeader>
        <CardContent className="flex min-h-0 flex-1 flex-col">
        <div key={connectionPanel} className="live-connection-content panel-enter">
        {connectionPanel === "choices" ? <div className="grid min-h-0 flex-1 content-center gap-3" aria-label="选择直播连接方式">
          <Button variant="outline" size="lg" className="w-full justify-between" disabled={active || pending} data-testid="live-connect-official" onClick={() => chooseConnection("official")}>官方开放平台<ChevronRightIcon aria-hidden="true" /></Button>
          <Button variant="outline" size="lg" className="w-full justify-between" disabled={active || pending} data-testid="live-connect-web" onClick={() => chooseConnection("web")}>网页直连<ChevronRightIcon aria-hidden="true" /></Button>
          {active && <p className="text-xs text-muted-foreground">停止直播后可修改连接。</p>}
        </div> : connectionPanel === "form" ? <form className="live-connect-form scrollbar-hidden" onSubmit={event => { event.preventDefault(); void perform(async () => {
          if (draft.connectionMode === "web") { await window.katarune.setLiveWebCredentials({ cookie: webCookie }); setWebCookie(""); }
          else { await window.katarune.setLiveCredentials(credentials); setCredentials({ appId: "", accessKey: "", accessSecret: "", identityCode: "" }); }
          useLiveState.getState().setState(await window.katarune.updateLiveSettings(draft));
          setConnectionView("info");
          useLiveState.getState().setState(await window.katarune.connectLiveRoom());
        }); }}>
          <div className="flex items-center gap-2"><TooltipIconButton tooltip="返回连接方式" aria-label="返回连接方式" disabled={pending} onClick={() => setConnectionView("choices")}><ArrowLeftIcon /></TooltipIconButton><span className="text-sm font-medium">{connectionModeLabel}</span></div>
          {draft.connectionMode === "official" ? <>
          <Field id="live-app-id" label="项目 ID" stacked><Input id="live-app-id" required disabled={active} autoComplete="off" inputMode="numeric" value={credentials.appId} onChange={event => setCredentials({ ...credentials, appId: event.target.value.trim() })} /></Field>
          <Field id="live-access-key" label="Access Key" stacked><Input id="live-access-key" required disabled={active} type="password" autoComplete="new-password" value={credentials.accessKey} onChange={event => setCredentials({ ...credentials, accessKey: event.target.value })} /></Field>
          <Field id="live-access-secret" label="Access Secret" stacked><Input id="live-access-secret" required disabled={active} type="password" autoComplete="new-password" value={credentials.accessSecret} onChange={event => setCredentials({ ...credentials, accessSecret: event.target.value })} /></Field>
          <Field id="live-identity-code" label="主播身份码" stacked><Input id="live-identity-code" required disabled={active} type="password" autoComplete="new-password" value={credentials.identityCode} onChange={event => setCredentials({ ...credentials, identityCode: event.target.value })} /></Field>
          </> : <>
          <Field id="live-web-room-id" label="直播间号" stacked><Input id="live-web-room-id" required disabled={active || pending} autoComplete="off" inputMode="numeric" pattern="[1-9][0-9]{0,14}" maxLength={15} value={draft.webRoomId} onChange={event => change("webRoomId", event.target.value.trim())} /></Field>
          <Field id="live-web-cookie" label="Cookie（可选）" stacked><Input id="live-web-cookie" disabled={active || pending} type="password" autoComplete="new-password" maxLength={16384} value={webCookie} placeholder="SESSDATA=…; buvid3=…" aria-describedby="live-web-cookie-help" onChange={event => setWebCookie(event.target.value)} /></Field>
          <p id="live-web-cookie-help" className="text-xs leading-5 text-muted-foreground">{state.webCredentialsConfigured ? "已保存登录态。留空确认将改为匿名连接。" : "留空匿名连接，用户名可能被隐藏。填写登录 Cookie 可获取更完整的信息，保存后不回显。"}</p>
          </>}
          <div className="live-connect-actions"><Button type="submit" size="sm" disabled={active || pending}>确定</Button></div>
        </form> : connectionPanel === "info" ? <div className="live-room-info" aria-label="直播间配置信息">
          <div className="live-room-navigation">
            <div className="flex min-w-0 items-center gap-1"><TooltipIconButton size="icon-sm" tooltip="返回弹幕" aria-label="返回弹幕" onClick={() => setConnectionView("default")}><ArrowLeftIcon /></TooltipIconButton><span className="text-sm font-medium">直播间信息</span></div>
            <span className="live-room-method">{connectionModeLabel}</span>
          </div>
          <div className="live-room-details scrollbar-hidden">
            <div className="live-room-overview">
              <RoomCover src={state.roomCover} />
              <div className="live-room-summary">
                <h3 className="line-clamp-2 text-sm font-semibold leading-5 wrap-anywhere" title={state.roomName}>{state.roomName || "暂无直播标题"}</h3>
                <div className="live-room-meta">
                  <p className="live-room-id"><span>房间号</span><span>{state.roomId || state.settings.webRoomId || "检测中"}</span></p>
                  <Badge variant="secondary" className="text-muted-foreground data-[state=live]:bg-green-500/10 data-[state=live]:text-green-700 dark:data-[state=live]:text-green-400" data-state={state.broadcast}>{state.broadcast === "live" ? "直播中" : state.broadcast === "offline" ? "未开播" : "开播状态待确认"}</Badge>
                </div>
              </div>
            </div>
            <section className="live-room-description" aria-labelledby="live-room-description-label">
              <h4 id="live-room-description-label">直播间简介</h4>
              <p data-testid="live-room-description">{roomDescription}</p>
            </section>
          </div>
          <div className="live-room-actions">
            {active && <p className="text-xs text-muted-foreground">停止直播后可断开连接。</p>}
            <Button variant="outline" size="sm" disabled={active || pending} data-testid="live-disconnect" onClick={() => { void perform(async () => { useLiveState.getState().setState(await window.katarune.disconnectLiveRoom()); setConnectionView("default"); }); }}>断开连接</Button>
          </div>
        </div> : <>
          {onAir ? <div ref={events} className="live-event-list scrollbar-hidden" role="log" aria-label="直播间事件" aria-live="off">
            {!state.events.length && <div className="live-empty">等待观众互动</div>}
            {state.events.map(event => <div key={event.id} className={`live-event live-event-${event.kind}`}>
              {event.kind === "danmaku" ? <><b>{event.userName}</b><span>{event.text}</span></> : event.kind === "gift" ? <><b>{event.userName}</b><span>赠送 {event.giftName} × {event.quantity}</span><small>平台礼物</small></> : <span>{event.kind === "started" ? "直播间已开播" : event.kind === "ended" ? "直播间已下播" : "官方互动连接已结束"}</span>}
            </div>)}
          </div> : <div className="live-empty" role="status" data-testid="live-room-status">{roomStatus}</div>}
        </>}
        </div>
        </CardContent>
      </Card>
      <Card size="sm" className="live-parameters live-panel" role="region" aria-label="直播参数">
        <CardHeader><CardTitle><h2>参数</h2></CardTitle></CardHeader>
        <CardContent className="live-settings scrollbar-hidden">
          <Field id="live-instructions" label="直播说明" stacked><Textarea id="live-instructions" rows={3} maxLength={8000} placeholder="这场直播想聊什么、如何与观众互动……" value={draft.instructions} onChange={event => change("instructions", event.target.value)} onBlur={() => void save()} /></Field>
          <Field id="live-reply-interval" label="回复间隔（秒）"><Input id="live-reply-interval" type="number" min={5} max={300} value={draft.replyIntervalSeconds} onChange={event => change("replyIntervalSeconds", Number(event.target.value))} onBlur={() => void save()} /></Field>
          <Collapsible open={draft.proactive}>
            <Field id="live-proactive" label="空闲主动聊天"><Switch id="live-proactive" checked={draft.proactive} onCheckedChange={checked => change("proactive", checked, true)} /></Field>
            <CollapsibleContent><div className="pt-4"><Field id="live-idle-seconds" label="空闲时间（秒）"><Input id="live-idle-seconds" type="number" min={15} max={1800} value={draft.idleSeconds} onChange={event => change("idleSeconds", Number(event.target.value))} onBlur={() => void save()} /></Field></div></CollapsibleContent>
          </Collapsible>
          <Field id="live-thank-gifts" label="感谢礼物"><Switch id="live-thank-gifts" checked={draft.thankGifts} onCheckedChange={checked => change("thankGifts", checked, true)} /></Field>
          <SettingsSection id="live-presentation-settings" title="画面与声音">
            <Collapsible open={draft.background === "solid"}>
              <Field id="live-background" label="背景"><OptionSelect<LiveSettings["background"]> id="live-background" label="背景" value={draft.background} options={[{ value: "immersive", label: "沉浸背景" }, { value: "solid", label: "纯色" }]} onValueChange={value => change("background", value, true)} /></Field>
              <CollapsibleContent><div className="pt-4"><Field id="live-background-color" label="背景颜色"><Input id="live-background-color" type="color" className="p-1" value={draft.backgroundColor} onChange={event => change("backgroundColor", event.target.value, true)} /></Field></div></CollapsibleContent>
            </Collapsible>
            <Field id="live-camera" label="镜头"><OptionSelect<LiveSettings["camera"]> id="live-camera" label="镜头" value={draft.camera} options={[{ value: "overhead", label: "俯视" }, { value: "center", label: "居中" }, { value: "closeup", label: "近景" }]} onValueChange={value => change("camera", value, true)} /></Field>
            <Field id="live-subtitles" label="显示字幕"><Switch id="live-subtitles" checked={draft.subtitles} onCheckedChange={checked => change("subtitles", checked, true)} /></Field>
            <Field id="live-voice-volume" label="语音音量（%）"><Input id="live-voice-volume" type="number" min={0} max={100} step={5} value={Math.round(draft.voiceVolume * 100)} onChange={event => change("voiceVolume", Number(event.target.value) / 100)} onBlur={() => void save()} /></Field>
            <Field id="live-music-volume" label="配乐音量（%）"><Input id="live-music-volume" type="number" min={0} max={100} step={5} value={Math.round(draft.musicVolume * 100)} onChange={event => change("musicVolume", Number(event.target.value) / 100)} onBlur={() => void save()} /></Field>
          </SettingsSection>
          <SettingsSection id="live-output-settings" title="输出设置">
            <Field id="live-resolution" label="分辨率"><OptionSelect<LiveSettings["width"]> id="live-resolution" label="分辨率" title={`${draft.width} × ${draft.width * 9 / 16}`} disabled={active} value={draft.width} options={[{ value: 1280, label: "720p" }, { value: 1920, label: "1080p · 推荐" }, { value: 2560, label: "1440p" }]} onValueChange={value => change("width", value, true)} /></Field>
            <Field id="live-port" label="本地端口"><Input id="live-port" disabled={active} type="number" min={1024} max={65535} value={draft.port} onChange={event => change("port", Number(event.target.value))} onBlur={() => void save()} /></Field>
          </SettingsSection>
          <div className="live-output"><span>RTMP 拉流地址</span><div><code>{`rtmp://127.0.0.1:${state.settings.port}/katarune/live`}</code><TooltipIconButton tooltip="复制拉流地址" onClick={() => { void navigator.clipboard.writeText(`rtmp://127.0.0.1:${state.settings.port}/katarune/live`).catch(report); }}><CopyIcon size={16} /></TooltipIconButton></div></div>
        </CardContent>
      </Card>
    </div>
    <footer className="live-footer"><div className="live-character">
      <Popover open={pickRole && !active} onOpenChange={setPickRole}>
      <PopoverTrigger data-testid="live-character-trigger" title={character.name}
        aria-label={`切换直播角色，当前：${character.name}`} disabled={active}
        render={<Button variant="ghost" size="lg" className="max-w-60" />}>
        <Avatar aria-hidden="true">
          {portraitId && <AvatarImage src={assetUrl(portraitId)} alt="" />}
          <AvatarFallback>{character.name.slice(0, 1)}</AvatarFallback>
        </Avatar>
        <span className="truncate" data-testid="live-character-name">{character.name}</span>
        <ChevronUpIcon aria-hidden="true" className="text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent side="top" align="start" matchTriggerWidth className="live-character-menu max-h-80 gap-0 overflow-y-auto" aria-label="选择直播角色">{characters.map(item => {
        const imageId = item.packageThumbnailAssetId ?? item.packagePortraitAssetId;
        return <Button key={item.id} variant={item.id === character.id ? "secondary" : "ghost"} size="lg" className="w-full justify-start"
          aria-current={item.id === character.id ? true : undefined}
          onClick={() => { setPickRole(false); change("characterId", item.id, true); }}>
          <Avatar size="sm" aria-hidden="true">
            {imageId && <AvatarImage src={assetUrl(imageId)} alt="" />}
            <AvatarFallback>{item.name.slice(0, 1)}</AvatarFallback>
          </Avatar>
          <span className="truncate">{item.name}</span>
        </Button>;
      })}</PopoverContent>
      </Popover>
    </div>
      <Button size="lg" className="ml-auto min-w-28" data-testid="live-toggle" disabled={state.phase === "stopping" || (pending && !active)} onClick={() => { if (active) void window.katarune.stopLive().catch(report); else void perform(() => window.katarune.startLive()); }}>
        {transitioning && <LoaderCircleIcon className="animate-spin" size={16} />}{active ? "停止" : "启动"}
      </Button>
    </footer>
  </main>;
}
