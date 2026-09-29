/// <reference path="./worklet.d.ts" />
import type { AvatarBinding } from '../../../shared/avatar';
import type { AsrResult } from '../../../shared/asr';
import { useAvatarState } from '../chat/avatarState';
import { notify } from '../notifications/notificationCenter';
import { cancelLocalDictation } from './KataruneDictationAdapter';
import captureUrl from './speech-capture.worklet.js?no-inline&url';

export type VoicePhase = 'idle' | 'preparing' | 'listening' | 'recording' | 'waiting' | 'transcribing' | 'error';
type Target = { send(text: string): Promise<void>; interrupt(text: string): Promise<void>;
  isLikelyEcho?(text: string): boolean; state(): { busy: boolean; available: boolean; pending?: boolean; error?: Error | undefined } };
type Snapshot = { phase: VoicePhase; binding: AvatarBinding | null };
const key = (binding: AvatarBinding) => `${binding.characterId}:${binding.threadId}`;
const targets = new Map<string, Target>();
let snapshot: Snapshot = { phase: 'idle', binding: null };
const listeners = new Set<() => void>();
let current: VoiceSession | undefined;
let failedBinding: string | undefined;
function publish(phase: VoicePhase, binding: AvatarBinding | null) {
  if (snapshot.phase === phase && snapshot.binding === binding) return;
  snapshot = { phase, binding }; listeners.forEach(listener => listener());
  if (binding) void window.katarune.setAvatarVoiceState({ binding, phase, error: null }).catch(() => {});
}
function maybeStart(): void {
  const status = useAvatarState.getState().status;
  if (current || status.phase !== 'ready' || !status.binding || !status.voice?.desired || status.voice.phase === 'error'
    || failedBinding === key(status.binding)) return;
  if (targets.has(key(status.binding))) void realtimeVoice.start();
}
export const realtimeVoice = {
  subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  getSnapshot: () => snapshot,
  register(binding: AvatarBinding, target: Target): () => void {
    const id = key(binding); targets.set(id, target); queueMicrotask(maybeStart);
    return () => { if (targets.get(id) === target) { targets.delete(id); if (current && key(current.binding) === id) current.stop(); } };
  },
  changed() { current?.reconcile(); maybeStart(); },
  beforeSend(binding: AvatarBinding) { if (current && key(current.binding) === key(binding)) current.beforeTextSend(); },
  stop() { current?.stop(); },
  fail(message: string) { current?.fail(message); },
  async start() {
    if (current) return;
    const avatar = useAvatarState.getState().status;
    if (avatar.phase !== 'ready' || !avatar.binding) {
      return;
    }
    const target = targets.get(key(avatar.binding));
    if (target?.state().pending) return;
    if (!target?.state().available) {
      void window.katarune.setAvatarVoiceState({ binding: avatar.binding, phase: 'error', error: '请配置可用的对话、语音合成和识别模型。' }); return;
    }
    cancelLocalDictation();
    const session = new VoiceSession(avatar.binding, target);
    current = session;
    await session.start();
  },
  mount(): () => void {
    let alive = true;
    let received = false;
    const unsubscribe = window.katarune.onAvatarStatus(status => {
      received = true; useAvatarState.getState().setStatus(status);
      if (!status.voice?.desired) failedBinding = undefined;
      current?.reconcile(); maybeStart();
    });
    void window.katarune.getAvatarStatus().then(status => {
      if (alive && !received) { useAvatarState.getState().setStatus(status); maybeStart(); }
    }).catch(() => {});
    const unprogress = window.katarune.onAsrTranscribing(requestId => {
      if (current?.requestId === requestId) current.transcribing();
    });
    const unstore = useAvatarState.subscribe(() => { current?.reconcile(); maybeStart(); });
    return () => { alive = false; unsubscribe(); unprogress(); unstore(); current?.stop(); };
  },
};

class VoiceSession {
  readonly requestId = crypto.randomUUID();
  private stream?: MediaStream;
  private context?: AudioContext;
  private worklet?: AudioWorkletNode;
  private closed = false;
  private ready = false;
  private gate = false;
  private epoch = 0;
  private pumping = false;
  private submitting = false;
  private resuming = false;
  private initialError: Error | undefined;
  private provisional = false;
  private wasResponding = false;
  private frames: Float32Array[] = [];
  private resumeTimer: ReturnType<typeof setTimeout> | undefined;
  private lastLevelAt = 0;
  constructor(readonly binding: AvatarBinding, private target: Target) { this.initialError = target.state().error; }
  async start() {
    publish('preparing', this.binding);
    try {
      this.check(await window.katarune.prepareRealtimeAsr({ requestId: this.requestId, ...this.binding }));
      if (this.closed) return;
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: 'all', noiseSuppression: true }, video: false });
      } catch (error) {
        if (!(error instanceof DOMException) || (error.name !== 'OverconstrainedError' && error.name !== 'TypeError')) throw error;
        stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }, video: false });
      }
      if (this.closed) { stream.getTracks().forEach(track => track.stop()); return; }
      this.stream = stream;
      stream.getAudioTracks().forEach(track => { track.onended = () => this.fail('麦克风已断开，请在桌宠中重新开启语音。'); });
      const context = new AudioContext({ sampleRate: 16000 }); this.context = context;
      if (context.sampleRate !== 16000) throw new Error('当前设备无法以 16 kHz 采集语音。');
      await context.audioWorklet.addModule(captureUrl);
      if (this.closed) return;
      const worklet = new AudioWorkletNode(context, 'speech-capture'); this.worklet = worklet;
      const mute = context.createGain(); mute.gain.value = 0;
      context.createMediaStreamSource(stream).connect(worklet).connect(mute).connect(context.destination);
      worklet.port.onmessage = ({ data }: MessageEvent<Float32Array>) => {
        if (!this.gate || this.closed) return;
        const now = Date.now();
        if (now - this.lastLevelAt >= 100) {
          this.lastLevelAt = now;
          let power = 0;
          for (const sample of data) power += sample * sample;
          const level = Math.min(1, Math.sqrt(power / data.length) * 5);
          void window.katarune.setAvatarVoiceState({ binding: this.binding, phase: snapshot.phase, error: null, level }).catch(() => {});
        }
        if (this.frames.length >= 3) { this.fail('语音处理跟不上采集速度，请在桌宠中重试。'); return; }
        this.frames.push(data); void this.pump();
      };
      worklet.onprocessorerror = () => this.fail('麦克风采集失败，请在桌宠中重试。');
      await context.resume();
      if (this.closed) return;
      this.ready = true; this.reconcile();
    } catch (error) { if (!this.closed) this.fail(error instanceof Error ? error.message : '无法启动实时对话。'); }
  }
  private check(result: AsrResult) {
    if (result.status !== 'success') throw new Error(result.status === 'error' ? result.message : '语音会话已结束，请长按重试。');
  }
  private busy() {
    const avatar = useAvatarState.getState();
    return !!avatar.status.busy || this.target.state().busy || (avatar.queued[this.binding.threadId] ?? 0) > 0;
  }
  reconcile() {
    if (this.closed) return;
    const avatar = useAvatarState.getState().status;
    if (avatar.phase !== 'ready' || !avatar.binding || key(avatar.binding) !== key(this.binding) || !avatar.voice?.desired) { this.stop(); return; }
    if (avatar.error && /语音合成|语音播放|播放设备/.test(avatar.error)) { this.fail(avatar.error); return; }
    const target = this.target.state();
    if (target.pending) return;
    if (!target.available) { this.fail('语音会话配置已失效，请检查模型和音色后重试。'); return; }
    if (target.error && target.error !== this.initialError) { this.fail(target.error.message); return; }
    if (!this.ready) return;
    if (this.submitting) return;
    if (this.gate || this.resumeTimer || this.resuming || snapshot.phase === 'transcribing') return;
    const epoch = this.epoch;
    this.resumeTimer = setTimeout(() => {
      this.resumeTimer = undefined;
      if (this.closed || epoch !== this.epoch || this.submitting) return;
      this.resuming = true;
      void window.katarune.resetRealtimeAsr({ requestId: this.requestId }).then(result => {
        if (this.closed || epoch !== this.epoch || this.submitting) return;
        this.check(result); this.gate = true; this.worklet?.port.postMessage(true); publish('listening', this.binding);
      }).catch(error => { if (!this.closed) this.fail(String(error)); }).finally(() => { this.resuming = false; this.reconcile(); });
    }, 300);
  }
  transcribing() {
    if (this.closed || !this.gate) return;
    this.gate = false; this.frames = []; this.worklet?.port.postMessage(false);
    if (!this.closed) publish('transcribing', this.binding);
  }
  block() {
    this.epoch++; this.gate = false; this.frames = [];
    clearTimeout(this.resumeTimer); this.resumeTimer = undefined;
    this.worklet?.port.postMessage(false);
    if (this.ready && !this.closed) publish('waiting', this.binding);
  }
  beforeTextSend() {
    this.block();
    if (this.provisional) void window.katarune.controlAvatarPlayback({ binding: this.binding, action: 'resume' }).catch(() => {});
    this.provisional = false;
    this.wasResponding = false;
    this.reconcile();
  }
  private async pump() {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.gate && !this.closed && this.frames.length) {
        const epoch = this.epoch;
        const result = await window.katarune.pushAsrFrame({ requestId: this.requestId, samples: new Float32Array(this.frames.shift()!) });
        if (this.closed || epoch !== this.epoch) continue;
        this.check(result);
        if (result.status !== 'success') continue;
        if (!result.complete) {
          if (result.speech && !this.provisional && this.busy()) {
            this.provisional = true; this.wasResponding = true;
            void window.katarune.controlAvatarPlayback({ binding: this.binding, action: 'pause' }).catch(() => {});
          }
          publish(result.speech ? 'recording' : 'listening', this.binding); continue;
        }
        this.block();
        const text = result.text.trim();
        const playback = useAvatarState.getState().status.playback;
        const echo = !!text && this.wasResponding && (playback?.state === 'playing' || playback?.state === 'paused')
          && !!this.target.isLikelyEcho?.(text);
        if (text && !echo) {
          this.submitting = true;
          const interrupted = this.wasResponding || this.busy();
          try {
            if (interrupted) await window.katarune.controlAvatarPlayback({ binding: this.binding, action: 'interrupt' });
            await window.katarune.showAvatarUserSubtitle({ binding: this.binding, text });
            const task = interrupted ? this.target.interrupt(text) : this.target.send(text);
            void task.catch(error => this.fail(error instanceof Error ? error.message : String(error)));
          } finally { this.submitting = false; }
        } else if (this.provisional) {
          void window.katarune.controlAvatarPlayback({ binding: this.binding, action: 'resume' }).catch(() => {});
        }
        this.provisional = false; this.wasResponding = false;
        this.reconcile();
      }
    } catch (error) { if (!this.closed) this.fail(error instanceof Error ? error.message : '实时对话失败，请在桌宠中重试。'); }
    finally { this.pumping = false; }
  }
  fail(message: string) { if (this.closed) return; failedBinding = key(this.binding); this.stop(); void window.katarune.setAvatarVoiceState({ binding: this.binding, phase: 'error', error: message }).catch(() => {}); notify({ level: 'error', message }); }
  stop() {
    if (this.closed) return;
    this.closed = true; this.block();
    if (this.provisional) void window.katarune.controlAvatarPlayback({ binding: this.binding, action: 'resume' }).catch(() => {});
    this.stream?.getTracks().forEach(track => { track.onended = null; track.stop(); });
    this.worklet?.disconnect();
    if (this.context && this.context.state !== 'closed') void this.context.close().catch(() => {});
    window.katarune.cancelAsr({ requestId: this.requestId });
    if (current === this) { current = undefined; publish('idle', null); }
  }
}
