import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronUpIcon, CopyIcon, Volume2Icon, VolumeXIcon, LoaderCircleIcon } from "lucide-react";
import { Button } from "../components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "../components/ui/avatar";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleIndicator, CollapsibleTrigger } from "../components/ui/collapsible";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { OptionSelect } from "../components/ui/option-select";
import { Popover, PopoverContent, PopoverTrigger } from "../components/ui/popover";
import { Switch } from "../components/ui/switch";
import { Textarea } from "../components/ui/textarea";
import { TooltipIconButton } from "../components/tooltip-icon-button";
import { PageHeader } from "../components/page-header";
import { PageLoading } from "../components/page-loading";
import { useCharacterSession } from "../characters/CharacterSessionProvider";
import { notify } from "../notifications";
import { assetUrl, type Character } from "../../../shared/ipc";
import { DEFAULT_LIVE_SETTINGS, type LiveSettings } from "../../../shared/live";
import { useLiveState } from "./liveState";
import { LiveConnectionPanel } from "./LiveConnectionPanel";
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

export function LivePage({ onClose }: { onClose: () => void }) {
  const state = useLiveState(s => s.state);
  const { activeCharacter } = useCharacterSession();
  const [characters, setCharacters] = useState<Character[]>([]);
  const [pickRole, setPickRole] = useState(false);
  const [draft, setDraft] = useState<LiveSettings>(state?.settings ?? DEFAULT_LIVE_SETTINGS);
  const [pending, setPending] = useState(false);
  const [previewReady, setPreviewReady] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const preview = useRef<LivePreviewPlayer | null>(null);
  const monitor = useRef(state?.monitor ?? false); monitor.current = state?.monitor ?? false;
  const initialized = useRef(false);
  const savedSettings = state?.settings;
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
  return <main className="live-page page-frame" data-testid="live-page">
    <PageHeader title="直播" onBack={onClose} backLabel="返回对话" />
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
      <LiveConnectionPanel state={state} disabled={active || pending} />
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
