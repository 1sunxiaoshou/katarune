import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../src/renderer/src/notifications/notificationCenter', () => ({ notify: vi.fn() }));
vi.mock('../src/renderer/src/speech/KataruneDictationAdapter', () => ({ cancelLocalDictation: vi.fn() }));
vi.mock('../src/renderer/src/speech/speech-capture.worklet.js?no-inline&url', () => ({ default: '/capture.js' }));
import { realtimeVoice } from '../src/renderer/src/speech/realtimeVoice';
import { useAvatarState } from '../src/renderer/src/chat/avatarState';
const binding = { characterId: '00000000-0000-4000-8000-000000000001', threadId: 'bound-thread' };
let processor: { port: { postMessage: ReturnType<typeof vi.fn>; onmessage: ((event: { data: Float32Array }) => void) | null } };
let api: { prepareRealtimeAsr: ReturnType<typeof vi.fn>; pushAsrFrame: ReturnType<typeof vi.fn>; resetRealtimeAsr: ReturnType<typeof vi.fn>; cancelAsr: ReturnType<typeof vi.fn> };
let track: { stop: ReturnType<typeof vi.fn>; onended: (() => void) | null };
let unregister: () => void;
let unmount: () => void;
let state: { busy: boolean; available: boolean; error?: Error };
let send = vi.fn(async (_text: string) => {});
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
beforeEach(() => {
  vi.useFakeTimers();
  api = { prepareRealtimeAsr: vi.fn(async () => ({ status: 'success', text: '' })), pushAsrFrame: vi.fn(async () => ({ status: 'success', text: '', speech: false })),
    resetRealtimeAsr: vi.fn(async () => ({ status: 'success', text: '' })), cancelAsr: vi.fn() };
  vi.stubGlobal('window', { katarune: { ...api, onAvatarStatus: () => () => {}, onAsrTranscribing: () => () => {}, getAvatarStatus: async () => ({ phase: 'ready', binding, error: null, busy: false }) } });
  track = { stop: vi.fn(), onended: null };
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn(async () => ({ getTracks: () => [track], getAudioTracks: () => [track] })) } });
  const node = { connect: vi.fn(function () { return node; }) };
  vi.stubGlobal('AudioContext', class { sampleRate = 16000; state = 'running'; audioWorklet = { addModule: async () => {} }; destination = node;
    createGain() { return { ...node, gain: { value: 0 } }; } createMediaStreamSource() { return node; } async resume() {} async close() {} });
  vi.stubGlobal('AudioWorkletNode', class { port = { postMessage: vi.fn(), onmessage: null }; constructor() { processor = this; } disconnect() {} });
  state = { busy: false, available: true }; send = vi.fn(async (_text: string) => {});
  useAvatarState.setState({ status: { phase: 'ready', binding, error: null, busy: false }, queued: {} });
  unregister = realtimeVoice.register(binding, { state: () => state, send: async text => { await send(text); } });
  unmount = realtimeVoice.mount();
});
afterEach(() => { realtimeVoice.stop(); unregister(); unmount(); vi.unstubAllGlobals(); vi.useRealTimers(); });
async function listen() { await realtimeVoice.start(); await vi.advanceTimersByTimeAsync(300); expect(realtimeVoice.getSnapshot().phase).toBe('listening'); }
const frame = () => processor.port.onmessage?.({ data: new Float32Array(1600) });
describe('desktop voice turn coordination', () => {
  it('sends one utterance and waits for actual avatar drain before listening again', async () => {
    await listen();
    api.pushAsrFrame.mockResolvedValueOnce({ status: 'success', complete: true, text: '你好。' });
    send.mockImplementationOnce(async () => { useAvatarState.getState().setStatus({ phase: 'ready', binding, busy: true, error: null }); });
    frame(); await flush(); expect(send).toHaveBeenCalledExactlyOnceWith('你好。');
    await vi.advanceTimersByTimeAsync(1500); expect(realtimeVoice.getSnapshot().phase).toBe('waiting');
    frame(); expect(api.pushAsrFrame).toHaveBeenCalledTimes(1);
    useAvatarState.getState().setStatus({ phase: 'ready', binding, busy: false, error: null });
    await vi.advanceTimersByTimeAsync(299); expect(realtimeVoice.getSnapshot().phase).toBe('waiting');
    await vi.advanceTimersByTimeAsync(1); expect(realtimeVoice.getSnapshot().phase).toBe('listening');
  });
  it('drops in-flight text when the user exits or sends a text message', async () => {
    await listen(); let finish!: (value: unknown) => void;
    api.pushAsrFrame.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    frame(); realtimeVoice.beforeSend(binding);
    finish({ status: 'success', complete: true, text: '旧片段' }); await flush(); expect(send).not.toHaveBeenCalled();
    realtimeVoice.changed(); await vi.advanceTimersByTimeAsync(300);
    api.pushAsrFrame.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    frame(); realtimeVoice.stop(); finish({ status: 'success', complete: true, text: '退出后片段' }); await flush();
    expect(send).not.toHaveBeenCalled(); expect(track.stop).toHaveBeenCalledTimes(1);
  });
  it('does not submit empty recognition and releases the microphone on rebind', async () => {
    await listen(); api.pushAsrFrame.mockResolvedValueOnce({ status: 'success', complete: true, text: '  ' });
    frame(); await flush(); await vi.advanceTimersByTimeAsync(300); expect(send).not.toHaveBeenCalled();
    expect(realtimeVoice.getSnapshot().phase).toBe('listening');
    useAvatarState.getState().setStatus({ phase: 'ready', binding: { ...binding, threadId: 'other' }, error: null });
    expect(realtimeVoice.getSnapshot().phase).toBe('idle'); expect(track.stop).toHaveBeenCalledTimes(1);
  });
  it('retains the bound destination even when another target registers', async () => {
    await listen(); const other = vi.fn(async () => {});
    const remove = realtimeVoice.register({ ...binding, threadId: 'other' }, { state: () => state, send: other });
    api.pushAsrFrame.mockResolvedValueOnce({ status: 'success', complete: true, text: '原会话' }); frame(); await flush();
    expect(send).toHaveBeenCalledExactlyOnceWith('原会话'); expect(other).not.toHaveBeenCalled(); remove();
  });
  it('stops on capture or playback failure without resending', async () => {
    await listen(); useAvatarState.getState().setStatus({ phase: 'ready', binding, error: '播放失败' });
    expect(realtimeVoice.getSnapshot().phase).toBe('idle'); expect(send).not.toHaveBeenCalled(); expect(track.stop).toHaveBeenCalledTimes(1);
  });
});
