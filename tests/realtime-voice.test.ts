import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../src/renderer/src/notifications/notificationCenter', () => ({ notify: vi.fn() }));
vi.mock('../src/renderer/src/speech/KataruneDictationAdapter', () => ({ cancelLocalDictation: vi.fn() }));
vi.mock('../src/renderer/src/speech/speech-capture.worklet.js?no-inline&url', () => ({ default: '/capture.js' }));
import { realtimeVoice } from '../src/renderer/src/speech/realtimeVoice';
import { useAvatarState } from '../src/renderer/src/chat/avatarState';

const binding = { characterId: '00000000-0000-4000-8000-000000000001', threadId: 'bound-thread' };
const ready = (busy = false) => ({ phase: 'ready' as const, binding, error: null, busy,
  voice: { desired: true, phase: 'listening' as const, error: null } });
let processor: { port: { postMessage: ReturnType<typeof vi.fn>; onmessage: ((event: { data: Float32Array }) => void) | null } };
let api: { prepareRealtimeAsr: ReturnType<typeof vi.fn>; pushAsrFrame: ReturnType<typeof vi.fn>;
  resetRealtimeAsr: ReturnType<typeof vi.fn>; cancelAsr: ReturnType<typeof vi.fn>;
  controlAvatarPlayback: ReturnType<typeof vi.fn>; showAvatarUserSubtitle: ReturnType<typeof vi.fn>;
  setAvatarVoiceState: ReturnType<typeof vi.fn> };
let track: { stop: ReturnType<typeof vi.fn>; onended: (() => void) | null };
let unregister: () => void;
let unmount: () => void;
let state: { busy: boolean; available: boolean; pending?: boolean; error?: Error };
let send = vi.fn(async (_text: string) => {});
let interrupt = vi.fn(async (_text: string) => {});
let echo = vi.fn((_text: string) => false);
const flush = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };

beforeEach(() => {
  vi.useFakeTimers();
  api = {
    prepareRealtimeAsr: vi.fn(async () => ({ status: 'success', text: '' })),
    pushAsrFrame: vi.fn(async () => ({ status: 'success', text: '', speech: false })),
    resetRealtimeAsr: vi.fn(async () => ({ status: 'success', text: '' })),
    cancelAsr: vi.fn(), controlAvatarPlayback: vi.fn(async () => {}),
    showAvatarUserSubtitle: vi.fn(async () => {}), setAvatarVoiceState: vi.fn(async () => {}),
  };
  vi.stubGlobal('window', { katarune: { ...api, onAvatarStatus: () => () => {}, onAsrTranscribing: () => () => {}, getAvatarStatus: async () => ready() } });
  track = { stop: vi.fn(), onended: null };
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn(async () => ({ getTracks: () => [track], getAudioTracks: () => [track] })) } });
  const node = { connect: vi.fn(function () { return node; }) };
  vi.stubGlobal('AudioContext', class { sampleRate = 16000; state = 'running'; audioWorklet = { addModule: async () => {} }; destination = node;
    createGain() { return { ...node, gain: { value: 0 } }; } createMediaStreamSource() { return node; } async resume() {} async close() {} });
  vi.stubGlobal('AudioWorkletNode', class { port = { postMessage: vi.fn(), onmessage: null }; constructor() { processor = this; } disconnect() {} });
  state = { busy: false, available: true };
  send = vi.fn(async (_text: string) => {}); interrupt = vi.fn(async (_text: string) => {}); echo = vi.fn((_text: string) => false);
  useAvatarState.setState({ status: ready(), queued: {} });
  unregister = realtimeVoice.register(binding, { state: () => state, send, interrupt, isLikelyEcho: text => echo(text) });
  unmount = realtimeVoice.mount();
});
afterEach(() => { realtimeVoice.stop(); unregister(); unmount(); vi.unstubAllGlobals(); vi.useRealTimers(); });
async function listen() { await flush(); await vi.advanceTimersByTimeAsync(300); expect(realtimeVoice.getSnapshot().phase).toBe('listening'); }
const frame = () => processor.port.onmessage?.({ data: new Float32Array(1600) });

describe('desktop voice turn coordination', () => {
  it('waits for the first asynchronous speech capability check before auto-starting', async () => {
    realtimeVoice.stop(); unregister(); api.prepareRealtimeAsr.mockClear();
    state.available = false; state.pending = true;
    unregister = realtimeVoice.register(binding, { state: () => state, send, interrupt });
    await flush();
    expect(api.prepareRealtimeAsr).not.toHaveBeenCalled();
    state.available = true; state.pending = false; realtimeVoice.changed();
    await listen();
    expect(api.prepareRealtimeAsr).toHaveBeenCalledTimes(1);
  });
  it('automatically enables capture and keeps receiving while the avatar is busy', async () => {
    await listen(); useAvatarState.getState().setStatus(ready(true));
    api.pushAsrFrame.mockResolvedValueOnce({ status: 'success', complete: true, text: '你好。' });
    frame(); await flush();
    expect(api.pushAsrFrame).toHaveBeenCalledTimes(1);
    expect(interrupt).toHaveBeenCalledExactlyOnceWith('你好。');
    expect(api.controlAvatarPlayback).toHaveBeenCalledWith({ binding, action: 'interrupt' });
    expect(api.showAvatarUserSubtitle).toHaveBeenCalledWith({ binding, text: '你好。' });
    await vi.advanceTimersByTimeAsync(300); expect(realtimeVoice.getSnapshot().phase).toBe('listening');
  });
  it('pauses on provisional voice and resumes after an empty recognition', async () => {
    await listen(); useAvatarState.getState().setStatus(ready(true));
    api.pushAsrFrame.mockResolvedValueOnce({ status: 'success', complete: false, speech: true, text: '' });
    frame(); await flush();
    expect(api.controlAvatarPlayback).toHaveBeenCalledWith({ binding, action: 'pause' });
    api.pushAsrFrame.mockResolvedValueOnce({ status: 'success', complete: true, speech: false, text: '' });
    frame(); await flush();
    expect(api.controlAvatarPlayback).toHaveBeenCalledWith({ binding, action: 'resume' });
    expect(send).not.toHaveBeenCalled(); expect(interrupt).not.toHaveBeenCalled();
  });
  it('treats a matching speaker echo as a false alarm and resumes playback', async () => {
    await listen(); useAvatarState.getState().setStatus({ ...ready(true), playback: { runId: 'old', state: 'playing' } });
    echo.mockReturnValue(true);
    api.pushAsrFrame.mockResolvedValueOnce({ status: 'success', complete: false, speech: true, text: '' });
    frame(); await flush();
    api.pushAsrFrame.mockResolvedValueOnce({ status: 'success', complete: true, speech: true, text: '角色自己说的话' });
    frame(); await flush();
    expect(echo).toHaveBeenCalledWith('角色自己说的话');
    expect(api.controlAvatarPlayback).toHaveBeenCalledWith({ binding, action: 'resume' });
    expect(interrupt).not.toHaveBeenCalled();
    expect(api.showAvatarUserSubtitle).not.toHaveBeenCalled();
  });
  it('ignores late ASR results after a text send or rebind', async () => {
    await listen(); let finish!: (value: unknown) => void;
    api.pushAsrFrame.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    frame(); realtimeVoice.beforeSend(binding);
    finish({ status: 'success', complete: true, text: '旧片段' }); await flush();
    expect(send).not.toHaveBeenCalled(); expect(interrupt).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(300);
    useAvatarState.getState().setStatus({ ...ready(), binding: { ...binding, threadId: 'other' } });
    expect(realtimeVoice.getSnapshot().phase).toBe('idle'); expect(track.stop).toHaveBeenCalledTimes(1);
  });
  it('resumes provisional playback when a typed message takes the turn', async () => {
    await listen(); useAvatarState.getState().setStatus(ready(true));
    api.pushAsrFrame.mockResolvedValueOnce({ status: 'success', complete: false, speech: true, text: '' });
    frame(); await flush();
    realtimeVoice.beforeSend(binding); await flush();
    expect(api.controlAvatarPlayback).toHaveBeenCalledWith({ binding, action: 'pause' });
    expect(api.controlAvatarPlayback).toHaveBeenCalledWith({ binding, action: 'resume' });
  });
  it('preserves the bound target when another thread registers', async () => {
    await listen(); const other = vi.fn(async () => {});
    const remove = realtimeVoice.register({ ...binding, threadId: 'other' }, { state: () => state, send: other, interrupt: other });
    api.pushAsrFrame.mockResolvedValueOnce({ status: 'success', complete: true, text: '原会话' });
    frame(); await flush(); expect(send).toHaveBeenCalledExactlyOnceWith('原会话'); expect(other).not.toHaveBeenCalled(); remove();
  });
  it('stops capture on device loss and reports a retryable error', async () => {
    await listen(); track.onended?.(); await flush();
    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(api.setAvatarVoiceState).toHaveBeenCalledWith(expect.objectContaining({ binding, phase: 'error' }));
  });
});
