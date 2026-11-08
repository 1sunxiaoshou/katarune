import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronUpIcon, CopyIcon, Volume2Icon, VolumeXIcon, LoaderCircleIcon } from "lucide-react";
import { Button } from "../components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "../components/ui/avatar";
import { Card, CardContent } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { OptionSelect } from "../components/ui/option-select";
import { Popover, PopoverContent, PopoverTrigger } from "../components/ui/popover";
import { Switch } from "../components/ui/switch";
import { Slider } from "../components/ui/slider";
import { Tabs, TabsContent, TabsIndicator, TabsList, TabsTrigger } from "../components/ui/tabs";
import { Textarea } from "../components/ui/textarea";
import { TooltipIconButton } from "../components/tooltip-icon-button";
import { PageHeader } from "../components/page-header";
import { PageLoading } from "../components/page-loading";
import { useCharacterSession } from "../characters/CharacterSessionProvider";
import { notify } from "../notifications";
import { assetUrl, type Character } from "../../../shared/ipc";
import { DEFAULT_LIVE_SETTINGS, liveOutputDimensions, type LiveSettings } from "../../../shared/live";
import { AVATAR_CAMERA_OPTIONS } from "../../../shared/avatarCamera";
import { useLiveState } from "./liveState";
import { LiveConnectionPanel } from "./LiveConnectionPanel";
import { LivePreviewPlayer } from "./livePreviewPlayer";
import "./live.css";

const report = (error: unknown) => notify({ level: "error", message: error instanceof Error ? error.message : "直播操作失败。" });
const SEGMENTED_LIST_CLASS = "relative isolate grid h-8! rounded-full bg-primary px-2 py-0.5 text-xs text-primary-foreground dark:bg-muted dark:text-muted-foreground";
const SEGMENTED_TAB_CLASS = "z-[1] w-full! min-w-0 justify-center! rounded-none px-1.5 text-[10px]! text-primary-foreground/70 hover:text-primary-foreground data-active:bg-transparent! data-active:text-foreground data-active:shadow-none! data-active:hover:text-foreground dark:text-muted-foreground dark:hover:text-foreground dark:data-active:border-transparent! dark:data-active:bg-transparent! dark:data-active:text-background dark:data-active:hover:text-background";
function Field({ id, label, stacked = false, children }: { id: string; label: string; stacked?: boolean; children: ReactNode }) {
  return <div className={`live-field${stacked ? " live-field-stacked" : ""}`}>
    <Label htmlFor={id}>{label}</Label>
    {children}
  </div>;
}

function VolumeField({ id, label, value, onValueChange, onValueCommitted }: {
  id: string; label: string; value: number;
  onValueChange: (value: number) => void; onValueCommitted: (value: number) => void;
}) {
  const percent = Math.round(value * 100);
  return <div className="live-volume-field">
    <Label htmlFor={id}>{label}</Label>
    <Slider id={`${id}-slider`} aria-label={`${label}音量`} min={0} max={100} step={1} value={percent}
      onValueChange={next => onValueChange(next / 100)} onValueCommitted={next => onValueCommitted(next / 100)} />
    <span className="live-volume-value">
      <Input id={id} aria-label={`${label}音量（百分比）`} type="number" min={0} max={100} step={1} value={percent}
        className="live-volume-number"
        onChange={event => {
          const next = event.currentTarget.valueAsNumber;
          if (Number.isFinite(next)) onValueChange(Math.min(100, Math.max(0, next)) / 100);
        }} onBlur={() => onValueCommitted(value)} />
      <span aria-hidden="true">%</span>
    </span>
  </div>;
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
  const resolutionTitle = (width: LiveSettings["width"]) => {
    const size = liveOutputDimensions({ width, aspectRatio: draft.aspectRatio });
    return `${size.width} × ${size.height}`;
  };
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
      <section className={`live-preview text-muted-foreground${previewReady ? " is-ready dark" : ""}`} aria-label="直播画面预览">
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
        <CardContent className="live-parameter-content">
          <Tabs defaultValue="interaction" className="live-settings-tabs" onValueChange={() => {
            if (JSON.stringify(draft) !== JSON.stringify(state.settings)) void save();
          }}>
            <TabsList aria-label="直播参数分类" className={`${SEGMENTED_LIST_CLASS} w-full shrink-0 grid-cols-4`}>
              <TabsIndicator className="model-category-indicator" />
              {([
                ["interaction", "互动"], ["picture", "画面"], ["sound", "声音"], ["output", "输出"],
              ] as const).map(([value, label]) => <TabsTrigger key={value} id={`live-tab-${value}`} value={value}
                className={SEGMENTED_TAB_CLASS}>
                {label}
              </TabsTrigger>)}
            </TabsList>
            <TabsContent value="interaction" className="live-settings scrollbar-hidden">
              <Field id="live-instructions" label="直播说明" stacked><Textarea id="live-instructions" rows={3} maxLength={8000} placeholder="这场直播想聊什么、如何与观众互动……" value={draft.instructions} onChange={event => change("instructions", event.target.value)} onBlur={() => void save()} /></Field>
              <Field id="live-proactive" label="主动聊天"><Switch id="live-proactive" checked={draft.proactive} onCheckedChange={checked => change("proactive", checked, true)} /></Field>
            </TabsContent>
            <TabsContent value="picture" className="live-settings scrollbar-hidden">
              <Field id="live-camera" label="镜头"><OptionSelect<LiveSettings["camera"]> id="live-camera" label="镜头" value={draft.camera} options={AVATAR_CAMERA_OPTIONS} onValueChange={value => change("camera", value, true)} /></Field>
              <Field id="live-subtitles" label="显示字幕"><Switch id="live-subtitles" checked={draft.subtitles} onCheckedChange={checked => change("subtitles", checked, true)} /></Field>
            </TabsContent>
            <TabsContent value="sound" className="live-settings scrollbar-hidden">
              <VolumeField id="live-voice-volume" label="语音" value={draft.voiceVolume} onValueChange={value => change("voiceVolume", value)} onValueCommitted={value => change("voiceVolume", value, true)} />
              <VolumeField id="live-music-volume" label="配乐" value={draft.musicVolume} onValueChange={value => change("musicVolume", value)} onValueCommitted={value => change("musicVolume", value, true)} />
            </TabsContent>
            <TabsContent value="output" className="live-settings scrollbar-hidden">
              <div className="live-field">
                <Label id="live-aspect-ratio-label">输出比例</Label>
                <Tabs value={draft.aspectRatio} className="gap-0" onValueChange={value => {
                  if (value === "16:9" || value === "9:16") change("aspectRatio", value, true);
                }}>
                  <TabsList id="live-aspect-ratio" aria-labelledby="live-aspect-ratio-label" className={`${SEGMENTED_LIST_CLASS} w-full grid-cols-2`}>
                    <TabsIndicator className="model-category-indicator" />
                    <TabsTrigger id="live-aspect-landscape" value="16:9" disabled={active} className={SEGMENTED_TAB_CLASS}>横屏 16:9</TabsTrigger>
                    <TabsTrigger id="live-aspect-portrait" value="9:16" disabled={active} className={SEGMENTED_TAB_CLASS}>竖屏 9:16</TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>
              <div className="live-field">
                <Label id="live-resolution-label">分辨率</Label>
                <Tabs value={String(draft.width)} className="gap-0" onValueChange={value => {
                  if (value === "1920" || value === "2560") change("width", value === "1920" ? 1920 : 2560, true);
                }}>
                  <TabsList id="live-resolution" aria-labelledby="live-resolution-label" className={`${SEGMENTED_LIST_CLASS} w-full grid-cols-2`}>
                    <TabsIndicator className="model-category-indicator" />
                    <TabsTrigger id="live-resolution-1k" value="1920" title={resolutionTitle(1920)} disabled={active} className={SEGMENTED_TAB_CLASS}>1K</TabsTrigger>
                    <TabsTrigger id="live-resolution-2k" value="2560" title={resolutionTitle(2560)} disabled={active} className={SEGMENTED_TAB_CLASS}>2K</TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>
              {state.errorCode === "port-in-use" && <Field id="live-port" label="本地端口"><Input id="live-port" disabled={active} type="number" min={1024} max={65535} value={draft.port} onChange={event => change("port", Number(event.target.value))} onBlur={() => void save()} /></Field>}
              <div className="live-output"><span>RTMP 拉流地址</span><div><code>{`rtmp://127.0.0.1:${state.settings.port}/katarune/live`}</code><TooltipIconButton tooltip="复制拉流地址" onClick={() => { void navigator.clipboard.writeText(`rtmp://127.0.0.1:${state.settings.port}/katarune/live`).catch(report); }}><CopyIcon size={16} /></TooltipIconButton></div></div>
            </TabsContent>
          </Tabs>
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
