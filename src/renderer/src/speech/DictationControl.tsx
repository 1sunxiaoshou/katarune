import { useAui, useAuiState } from '@assistant-ui/react';
import { useEffect, useSyncExternalStore } from 'react';
import { MicIcon, SquareIcon, XIcon, LoaderCircleIcon } from 'lucide-react';
import { TooltipIconButton } from '../components/tooltip-icon-button';
import { cancelLocalDictation, dictationStore } from './KataruneDictationAdapter';
import { useAvatarState } from '../chat/avatarState';
import { useApplicationSettings } from '../settings/ApplicationSettingsProvider';
import { realtimeVoice } from './realtimeVoice';

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
  const label = realtime ? '桌宠语音请在 Unity HUD 中控制'
    : phase === 'preparing' ? '正在准备离线识别，单击取消'
    : phase === 'transcribing' ? '正在离线识别，单击取消'
    : phase === 'recording' ? '结束录音并识别'
    : !enabled ? '请在默认模型设置中启用语音识别'
    : busy || running ? '当前回复中，暂时无法听写'
    : '录音并填入聊天输入框';
  const loading = phase === 'preparing' || phase === 'transcribing';
  return <>
    <TooltipIconButton data-testid="dictation-toggle" data-state={phase}
      tooltip={label} aria-label={label}
      aria-busy={loading} disabled={realtime || (phase === 'idle' && (!enabled || busy || running))}
      size="icon" variant="ghost" className={`size-7 rounded-full ${phase === 'recording' ? 'text-destructive' : ''}`}
      onClick={() => {
        if (phase === 'recording') aui.composer().stopDictation();
        else if (phase !== 'idle') cancelLocalDictation();
        else if (enabled && !busy && !running) aui.composer().startDictation();
      }}>
      {loading ? <LoaderCircleIcon className="size-4 animate-spin" />
        : phase === 'recording' ? <SquareIcon className="size-3.5 fill-current" /> : <MicIcon className="size-4" />}
    </TooltipIconButton>
    <span className="sr-only" role="status">{label}</span>
    {!realtime && phase !== 'idle' && <TooltipIconButton tooltip="取消语音输入" aria-label="取消语音输入"
      size="icon" variant="ghost" className="size-7 rounded-full" onClick={cancelLocalDictation}><XIcon className="size-4" /></TooltipIconButton>}
  </>;
}
