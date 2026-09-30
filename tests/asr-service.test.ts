import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
const mock = vi.hoisted(() => ({ fork: vi.fn() }));
vi.mock('electron', () => ({ app: { getAppPath: () => '/app', isPackaged: false }, utilityProcess: { fork: mock.fork } }));
import { AsrService } from '../src/main/speech/asrService';
class Worker extends EventEmitter {
  messages: { id: string; operation: string }[] = [];
  kill = vi.fn();
  postMessage(message: { id: string; operation: string }) { this.messages.push(message); }
  reply(operation: string, text = '') {
    const index = this.messages.findIndex(message => message.operation === operation);
    const message = this.messages.splice(index, 1)[0]!;
    expect(message).toBeDefined();
    this.emit('message', { id: message.id, result: { status: 'success', text } });
  }
}
let worker: Worker;
let service: AsrService;
beforeEach(() => { vi.useFakeTimers(); worker = new Worker(); mock.fork.mockReset().mockReturnValue(worker); service = new AsrService('/app', '/resources'); });
afterEach(() => { service.dispose(); vi.useRealTimers(); });
async function prepare(id = 'first', realtime = false) {
  const pending = service.prepare(1, id, realtime);
  if (worker.messages.some(message => message.operation === 'load')) worker.reply('load');
  await Promise.resolve(); await Promise.resolve();
  if (realtime) worker.reply('vad-load');
  expect((await pending).status).toBe('success');
}
describe('resident speech worker', () => {
  it('retains weights after completion, cancellation and more than 60 seconds idle', async () => {
    await prepare();
    const result = service.transcribe(1, 'first', new Float32Array(160));
    worker.reply('transcribe', '你好。'); expect(await result).toEqual({ status: 'success', text: '你好。' });
    await vi.advanceTimersByTimeAsync(120_000);
    await prepare('second'); service.cancel(1, 'second');
    await prepare('third', true); service.cancel(1, 'third');
    expect(mock.fork).toHaveBeenCalledTimes(1); expect(worker.kill).not.toHaveBeenCalled();
  });
  it('shares an unfinished load after cancellation without lending its result to the old owner', async () => {
    const first = service.prepare(1, 'first'); service.cancel(1, 'first');
    const second = service.prepare(2, 'second'); worker.reply('load');
    expect(await first).toEqual({ status: 'cancelled' }); expect((await second).status).toBe('success');
    expect(mock.fork).toHaveBeenCalledTimes(1);
  });
  it('rejects stale inference and does not let another sender cancel a lease', async () => {
    await prepare();
    const first = service.transcribe(1, 'first', new Float32Array(160));
    service.cancel(2, 'first'); expect((await service.prepare(2, 'second')).status).toBe('error');
    service.cancel(1, 'first'); const second = service.prepare(2, 'second');
    expect((await second).status).toBe('success'); worker.reply('transcribe', '旧结果');
    expect(await first).toEqual({ status: 'cancelled' }); expect(worker.kill).not.toHaveBeenCalled();
  });
  it('keeps the realtime lease between frames, resets and transcription', async () => {
    await prepare('live', true);
    const frame = service.frame(1, 'live', new Float32Array(1600)); worker.reply('frame'); await frame;
    const reset = service.reset(1, 'live'); worker.reply('reset'); await reset;
    expect((await service.prepare(2, 'other')).status).toBe('error');
    service.cancel(1, 'live'); await prepare('normal'); expect(mock.fork).toHaveBeenCalledTimes(1);
  });
  it('destroys a stalled worker and allows recovery', async () => {
    await prepare(); const pending = service.transcribe(1, 'first', new Float32Array(160));
    await vi.advanceTimersByTimeAsync(90_000); expect((await pending).status).toBe('error');
    expect(worker.kill).toHaveBeenCalledTimes(1);
    worker = new Worker(); mock.fork.mockReturnValue(worker); await prepare('retry'); expect(mock.fork).toHaveBeenCalledTimes(2);
  });
});
