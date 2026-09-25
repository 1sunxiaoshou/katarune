/// <reference path="./worklet.d.ts" />
import type { AvatarBinding } from '../../../shared/avatar';
import type { AsrResult } from '../../../shared/asr';
import { useAvatarState } from '../chat/avatarState';
import { notify } from '../notifications/notificationCenter';
import { cancelLocalDictation } from './KataruneDictationAdapter';
import captureUrl from './speech-capture.worklet.js?no-inline&url';

export type VoicePhase = 'idle' | 'preparing' | 'listening' | 'recording' | 'waiting' | 'transcribing';
type Target = { send(text: string): Promise<void>; state(): { busy: boolean; available: boolean; error?: Error | undefined } };
type Snapshot = { phase: VoicePhase; binding: AvatarBinding | null };
const key = (binding: AvatarBinding) => `${binding.characterId}:${binding.threadId}`;
const targets = new Map<string, Target>();
let snapshot: Snapshot = { phase: 'idle', binding: null };
const listeners = new Set<() => void>();
let current: VoiceSession | undefined;
function publish(phase: VoicePhase, binding: AvatarBinding | null) {
  if (snapshot.phase === phase && snapshot.binding === binding) return;
  snapshot = { phase, binding }; listeners.forEach(listener => listener());
}
export const realtimeVoice = {
  subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  getSnapshot: () => snapshot,
  register(binding: AvatarBinding, target: Target): () => void {
    const id = key(binding); targets.set(id, target);
    return () => { if (targets.get(id) === target) { targets.delete(id); if (current && key(current.binding) === id) current.stop(); } };
  },
  changed() { current?.reconcile(); },
  beforeSend(binding: AvatarBinding) { if (current && key(current.binding) === key(binding)) current.block(); },
  stop() { current?.stop(); },
  fail(message: string) { current?.fail(message); },
  async start() {
    if (current) return;
    const avatar = useAvatarState.getState().status;
    if (avatar.phase !== 'ready' || !avatar.binding) {
      notify({ level: 'info', message: '请先连接桌宠，再长按开启实时对话。' }); return;
    }
    const target = targets.get(key(avatar.binding));
    if (!target?.state().available) {
      notify({ level: 'error', message: '请先为桌宠配置可用的对话模型、语音合成模型和音色。' }); return;
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
    });
    void window.katarune.getAvatarStatus().then(status => {
      if (alive && !received) useAvatarState.getState().setStatus(status);
    }).catch(() => {});
    const unprogress = window.katarune.onAsrTranscribing(requestId => {
      if (current?.requestId === requestId) current.transcribing();
    });
    const unstore = useAvatarState.subscribe(() => current?.reconcile());
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
  private frames: Float32Array[] = [];
  private resumeTimer: ReturnType<typeof setTimeout> | undefined;
  constructor(readonly binding: AvatarBinding, private target: Target) { this.initialError = target.state().error; }
  async start() {
    publish('preparing', this.binding);
    try {
      this.check(await window.katarune.prepareRealtimeAsr({ requestId: this.requestId, ...this.binding }));
      if (this.closed) return;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }, video: false });
      if (this.closed) { stream.getTracks().forEach(track => track.stop()); return; }
      this.stream = stream;
      stream.getAudioTracks().forEach(track => { track.onended = () => this.fail('麦克风已断开，请重新连接后长按重试。'); });
      const context = new AudioContext({ sampleRate: 16000 }); this.context = context;
      if (context.sampleRate !== 16000) throw new Error('当前设备无法以 16 kHz 采集语音。');
      await context.audioWorklet.addModule(captureUrl);
      if (this.closed) return;
      const worklet = new AudioWorkletNode(context, 'speech-capture'); this.worklet = worklet;
      const mute = context.createGain(); mute.gain.value = 0;
      context.createMediaStreamSource(stream).connect(worklet).connect(mute).connect(context.destination);
      worklet.port.onmessage = ({ data }: MessageEvent<Float32Array>) => {
        if (!this.gate || this.closed) return;
        if (this.frames.length >= 3) { this.fail('语音处理跟不上采集速度，请稍后长按重试。'); return; }
        this.frames.push(data); void this.pump();
      };
      worklet.onprocessorerror = () => this.fail('麦克风采集失败，请长按重试。');
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
    return !!avatar.status.busy || this.target.state().busy || Object.values(avatar.queued).some(count => count > 0) || this.submitting;
  }
  reconcile() {
    if (this.closed) return;
    const avatar = useAvatarState.getState().status;
    if (avatar.phase !== 'ready' || !avatar.binding || key(avatar.binding) !== key(this.binding)) { this.stop(); return; }
    if (avatar.error) { this.fail(avatar.error); return; }
    const target = this.target.state();
    if (!target.available) { this.fail('语音会话配置已失效，请检查模型和音色后重试。'); return; }
    if (target.error && target.error !== this.initialError) { this.fail(target.error.message); return; }
    if (!this.ready) return;
    if (this.busy()) { this.block(); return; }
    if (this.gate || this.resumeTimer || this.resuming || snapshot.phase === 'transcribing') return;
    const epoch = this.epoch;
    this.resumeTimer = setTimeout(() => {
      this.resumeTimer = undefined;
      if (this.closed || epoch !== this.epoch || this.busy()) return;
      this.resuming = true;
      void window.katarune.resetRealtimeAsr({ requestId: this.requestId }).then(result => {
        if (this.closed || epoch !== this.epoch || this.busy()) return;
        this.check(result); this.gate = true; this.worklet?.port.postMessage(true); publish('listening', this.binding);
      }).catch(error => { if (!this.closed) this.fail(String(error)); }).finally(() => { this.resuming = false; this.reconcile(); });
    }, 300);
  }
  transcribing() {
    if (this.closed || !this.gate || this.busy()) return;
    this.gate = false; this.frames = []; this.worklet?.port.postMessage(false);
    if (!this.closed) publish('transcribing', this.binding);
  }
  block() {
    this.epoch++; this.gate = false; this.frames = [];
    clearTimeout(this.resumeTimer); this.resumeTimer = undefined;
    this.worklet?.port.postMessage(false);
    if (this.ready && !this.closed) publish('waiting', this.binding);
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
        if (!result.complete) { publish(result.speech ? 'recording' : 'listening', this.binding); continue; }
        this.block();
        if (result.text.trim()) {
          this.submitting = true;
          try { await this.target.send(result.text.trim()); }
          finally { this.submitting = false; }
        }
        this.reconcile();
      }
    } catch (error) { if (!this.closed) this.fail(error instanceof Error ? error.message : '实时对话失败，请长按重试。'); }
    finally { this.pumping = false; }
  }
  fail(message: string) { if (this.closed) return; this.stop(); notify({ level: 'error', message }); }
  stop() {
    if (this.closed) return;
    this.closed = true; this.block();
    this.stream?.getTracks().forEach(track => { track.onended = null; track.stop(); });
    this.worklet?.disconnect();
    if (this.context && this.context.state !== 'closed') void this.context.close().catch(() => {});
    window.katarune.cancelAsr({ requestId: this.requestId });
    if (current === this) { current = undefined; publish('idle', null); }
  }
}
