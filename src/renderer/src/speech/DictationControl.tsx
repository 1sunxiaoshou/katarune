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
  const loading = phase === 'preparing' || phase === 'transcribing';
  const label = realtime ? '请在桌宠面板控制语音'
    : loading ? '取消听写'
    : phase === 'recording' ? '结束听写'
    : !enabled ? '语音识别未启用'
    : busy || running ? '回复中，听写不可用'
    : '听写';
  const statusText = realtime ? label
    : phase === 'preparing' ? '正在准备听写…'
    : phase === 'transcribing' ? '正在识别…'
    : label;
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
    <span className="sr-only" role="status">{statusText}</span>
    {!realtime && phase !== 'idle' && <TooltipIconButton tooltip="取消听写" aria-label="取消听写"
      size="icon" variant="ghost" className="size-7 rounded-full" onClick={cancelLocalDictation}><XIcon className="size-4" /></TooltipIconButton>}
  </>;
}
