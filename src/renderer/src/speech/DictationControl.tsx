import { useAui, useAuiState } from '@assistant-ui/react';
import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { MicIcon, SquareIcon, XIcon, LoaderCircleIcon, AudioLinesIcon } from 'lucide-react';
import { TooltipIconButton } from '../components/tooltip-icon-button';
import { cancelLocalDictation, dictationStore } from './KataruneDictationAdapter';
import { useAvatarState } from '../chat/avatarState';
import { useApplicationSettings } from '../settings/ApplicationSettingsProvider';
import { realtimeVoice } from './realtimeVoice';
import { HoldGesture } from './holdGesture';

export function DictationControl(): React.JSX.Element {
  const aui = useAui();
  const { appSettings } = useApplicationSettings();
  const enabled = appSettings.defaultAsrModel !== null;
  useEffect(() => { if (!enabled) { cancelLocalDictation(); realtimeVoice.stop(); } }, [enabled]);
  const threadId = useAuiState(state => state.threadListItem.id);
  const phase = useSyncExternalStore(dictationStore.subscribe, dictationStore.getSnapshot);
  const voice = useSyncExternalStore(realtimeVoice.subscribe, realtimeVoice.getSnapshot);
  const realtime = voice.phase !== 'idle';
  const busy = useAvatarState(state => state.status.busy);
  const running = useAuiState(state => state.thread.isRunning);
  useEffect(() => () => cancelLocalDictation(), [threadId]);
  const callbacks = useRef({ click: () => {}, hold: () => {} });
  callbacks.current = {
    click: () => {
      if (realtime) { realtimeVoice.stop(); return; }
      if (phase === 'recording') { aui.composer().stopDictation(); return; }
      if (phase !== 'idle') { cancelLocalDictation(); return; }
      if (enabled && !busy && !running) aui.composer().startDictation();
    },
    hold: () => { if (enabled && phase === 'idle' && !realtime) void realtimeVoice.start(); },
  };
  const gesture = useMemo(() => new HoldGesture(() => callbacks.current.hold(), () => callbacks.current.click()), []);
  useEffect(() => {
    const blur = () => gesture.cancel();
    window.addEventListener('blur', blur);
    return () => { gesture.cancel(); window.removeEventListener('blur', blur); };
  }, [gesture]);
  const label = realtime
    ? `${voice.phase === 'preparing' ? '正在准备实时对话' : voice.phase === 'transcribing' ? '实时对话：正在识别' : voice.phase === 'waiting' ? '实时对话：等待桌宠回复' : voice.phase === 'recording' ? '实时对话：正在收音' : '实时对话：正在监听'}，单击退出`
    : phase === 'preparing' ? '正在准备离线识别，单击取消'
    : phase === 'transcribing' ? '正在离线识别，单击取消'
    : phase === 'recording' ? '结束录音并识别'
    : !enabled ? '请在默认模型设置中启用语音识别'
    : busy || running ? '当前回复中；长按开启实时对话，回复结束后监听'
    : '单击录音，长按实时对话';
  const loading = phase === 'preparing' || phase === 'transcribing' || voice.phase === 'preparing' || voice.phase === 'transcribing';
  return <>
    <TooltipIconButton data-testid="dictation-toggle" data-state={realtime ? `realtime-${voice.phase}` : phase}
      tooltip={label} aria-label={phase === 'idle' && !realtime ? '开始离线语音输入' : label}
      aria-pressed={realtime} aria-busy={loading} disabled={!enabled && !realtime && phase === 'idle'}
      size="icon" variant="ghost" className={`size-7 rounded-full ${realtime ? 'bg-accent text-accent-foreground ring-1 ring-primary/40' : phase === 'recording' ? 'text-destructive' : ''}`}
      onPointerDown={event => { if (event.button === 0 && event.isPrimary) gesture.press(); }}
      onPointerUp={() => gesture.release()} onPointerLeave={() => gesture.cancel()} onPointerCancel={() => gesture.cancel()}
      onBlur={() => gesture.cancel()} onClick={() => gesture.click()}
      onKeyDown={event => {
        if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); if (!event.repeat) gesture.press(); }
      }}
      onKeyUp={event => {
        if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); gesture.click(); }
      }}>
      {loading ? <LoaderCircleIcon className="size-4 animate-spin" /> : realtime ? <AudioLinesIcon className="size-4" />
        : phase === 'recording' ? <SquareIcon className="size-3.5 fill-current" /> : <MicIcon className="size-4" />}
    </TooltipIconButton>
    <span className="sr-only" role="status">{label}</span>
    {!realtime && phase !== 'idle' && <TooltipIconButton tooltip="取消语音输入" aria-label="取消语音输入"
      size="icon" variant="ghost" className="size-7 rounded-full" onClick={cancelLocalDictation}><XIcon className="size-4" /></TooltipIconButton>}
  </>;
}
