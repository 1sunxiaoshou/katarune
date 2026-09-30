import type { DictationAdapter } from '@assistant-ui/react';
import { ASR_MAX_SECONDS, ASR_SAMPLE_RATE } from '../../../shared/asr';
import { notify } from '../notifications/notificationCenter';
import { cancelApplicationSpeech } from './KataruneSpeechSynthesisAdapter';

type Phase = 'idle' | 'preparing' | 'recording' | 'transcribing';
let phase: Phase = 'idle';
let active: LocalDictationSession | undefined;
const subscribers = new Set<() => void>();
export const dictationStore = {
  getSnapshot: () => phase,
  subscribe: (callback: () => void) => { subscribers.add(callback); return () => { subscribers.delete(callback); }; },
};
function setPhase(value: Phase): void { phase = value; subscribers.forEach((callback) => callback()); }
export function cancelLocalDictation(): void { active?.cancel(); }

class LocalDictationSession implements DictationAdapter.Session {
  status: DictationAdapter.Status = { type: 'starting' };
  private readonly requestId = crypto.randomUUID();
  private readonly starts = new Set<() => void>();
  private readonly speeches = new Set<(result: DictationAdapter.Result) => void>();
  private readonly ends = new Set<(result: DictationAdapter.Result) => void>();
  private stream: MediaStream | undefined;
  private recorder: MediaRecorder | undefined;
  private context: AudioContext | undefined;
  private chunks: Blob[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private stopping: Promise<void> | undefined;
  private readonly ready: Promise<void>;

  constructor() {
    active?.cancel();
    active = this;
    setPhase('preparing');
    // Defer until the runtime has subscribed to session events.
    this.ready = Promise.resolve().then(() => this.start());
  }
  onSpeechStart = (callback: () => void) => { this.starts.add(callback); return () => { this.starts.delete(callback); }; };
  onSpeech = (callback: (result: DictationAdapter.Result) => void) => { this.speeches.add(callback); return () => { this.speeches.delete(callback); }; };
  onSpeechEnd = (callback: (result: DictationAdapter.Result) => void) => { this.ends.add(callback); return () => { this.ends.delete(callback); }; };
  private get ended(): boolean { return this.status.type === 'ended'; }
  private async start(): Promise<void> {
    try {
      if (this.ended) return;
      cancelApplicationSpeech();
      const result = await window.katarune.prepareAsr({ requestId: this.requestId });
      if (this.ended) return;
      if (result.status !== 'success') throw new Error(result.status === 'error' ? result.message : '语音输入已取消。');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }, video: false });
      if (this.ended) { stream.getTracks().forEach((track) => track.stop()); return; }
      this.stream = stream;
      this.context = new AudioContext({ sampleRate: ASR_SAMPLE_RATE });
      await this.context.resume();
      if (this.ended) return;
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
      this.recorder = recorder;
      recorder.ondataavailable = (event) => { if (!this.ended && event.data.size) this.chunks.push(event.data); };
      recorder.onerror = () => this.fail('麦克风录音失败，请重试。');
      stream.getAudioTracks().forEach((track) => { track.onended = () => this.fail('麦克风已断开。'); });
      recorder.start(250);
      this.status = { type: 'running' };
      setPhase('recording');
      this.starts.forEach((callback) => callback());
      this.timer = setTimeout(() => { void this.stop(); }, ASR_MAX_SECONDS * 1000);
    } catch (error) {
      if (!this.ended) this.fail(error instanceof DOMException && error.name === 'NotAllowedError'
        ? '无法访问麦克风，请在系统隐私设置中允许麦克风访问。'
        : error instanceof Error ? error.message : '无法启动离线语音输入。');
    }
  }
  stop = (): Promise<void> => {
    if (!this.stopping) this.stopping = this.complete();
    return this.stopping;
  };
  private async complete(): Promise<void> {
    try {
      await this.ready;
      if (this.ended || !this.recorder || !this.context) return;
      clearTimeout(this.timer);
      setPhase('transcribing');
      const recorder = this.recorder;
      if (recorder.state !== 'inactive') {
        await new Promise<void>((resolve) => { recorder.addEventListener('stop', () => resolve(), { once: true }); recorder.stop(); });
      }
      this.stopTracks();
      if (this.ended) return;
      const bytes = await new Blob(this.chunks, { type: recorder.mimeType }).arrayBuffer();
      this.chunks = [];
      const audio = await this.context.decodeAudioData(bytes);
      if (this.ended) return;
      const count = Math.min(audio.length, ASR_MAX_SECONDS * ASR_SAMPLE_RATE);
      const samples = new Float32Array(count);
      for (let channel = 0; channel < audio.numberOfChannels; channel++) {
        const input = audio.getChannelData(channel);
        for (let i = 0; i < count; i++) samples[i] = Math.max(-1, Math.min(1, samples[i]! + input[i]! / audio.numberOfChannels));
      }
      const result = await window.katarune.transcribeAsr({ requestId: this.requestId, samples });
      if (this.ended) return;
      if (result.status === 'error') throw new Error(result.message);
      if (result.status === 'cancelled') { this.cancel(); return; }
      if (result.text) this.speeches.forEach((callback) => callback({ transcript: result.text, isFinal: true }));
      else notify({ level: 'info', message: '没有识别到语音，请重试。' });
      this.finish('stopped');
    } catch (error) { if (!this.ended) this.fail(error instanceof Error ? error.message : '离线识别失败，请重试。'); }
  }
  private stopTracks(): void {
    this.stream?.getTracks().forEach((track) => { track.onended = null; track.stop(); });
    this.stream = undefined;
  }
  cancel = (): void => {
    if (this.ended) return;
    window.katarune.cancelAsr({ requestId: this.requestId });
    this.finish('cancelled');
  };
  private fail(message: string): void {
    if (this.ended) return;
    notify({ level: 'error', message });
    window.katarune.cancelAsr({ requestId: this.requestId });
    this.finish('error');
  }
  private finish(reason: 'stopped' | 'cancelled' | 'error'): void {
    if (this.ended) return;
    this.status = { type: 'ended', reason };
    clearTimeout(this.timer);
    if (this.recorder?.state === 'recording') this.recorder.stop();
    this.stopTracks();
    void this.context?.close().catch(() => {});
    this.chunks = [];
    if (active === this) { active = undefined; setPhase('idle'); }
    this.ends.forEach((callback) => callback({ transcript: '', isFinal: true }));
  }
}

export class KataruneDictationAdapter implements DictationAdapter {
  disableInputDuringDictation = true;
  private session: LocalDictationSession | undefined;
  listen = (): DictationAdapter.Session => { this.session = new LocalDictationSession(); return this.session; };
  dispose = (): void => { this.session?.cancel(); };
}
