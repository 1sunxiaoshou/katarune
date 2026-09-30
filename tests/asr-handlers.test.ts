import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptyAppSettings } from "./defaultSettings";
import { ASR_CHANNELS } from "../src/shared/asr";

const mock = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  events: new Map<string, (...args: unknown[]) => unknown>(),
  prepare: vi.fn(async () => ({ status: "success", text: "" })),
  transcribe: vi.fn(async () => ({ status: "success", text: "你好。" })),
  cancel: vi.fn(),
  frame: vi.fn(async () => ({ status: 'success', text: '' })),
  reset: vi.fn(async () => ({ status: 'success', text: '' })),
}));

vi.mock("electron", () => ({ ipcMain: {
  handle: (channel: string, handler: (...args: unknown[]) => unknown) => mock.handlers.set(channel, handler),
  on: (channel: string, handler: (...args: unknown[]) => unknown) => mock.events.set(channel, handler),
} }));
vi.mock("../src/main/speech/asrService", () => ({ AsrService: class {
  prepare = mock.prepare;
  transcribe = mock.transcribe;
  cancel = mock.cancel;
  frame = mock.frame;
  reset = mock.reset;
} }));

import { registerAsrHandlers } from "../src/main/ipc/asrHandlers";

const requestId = "00000000-0000-4000-8000-000000000001";
const sender = { id: 42, once: vi.fn(), on: vi.fn(), removeListener: vi.fn() };
beforeEach(() => { vi.clearAllMocks(); mock.handlers.clear(); mock.events.clear(); });

describe("global ASR setting at the main boundary", () => {
  it("rejects preparation before loading the model when globally disabled", async () => {
    registerAsrHandlers({ getAppSettings: () => ({ ...emptyAppSettings, defaultAsrModel: null }) });
    await expect(mock.handlers.get(ASR_CHANNELS.prepare)?.({ sender }, { requestId }))
      .resolves.toMatchObject({ status: "error" });
    expect(mock.prepare).not.toHaveBeenCalled();
  });

  it("rechecks the setting before transcription and cancels the owned request", async () => {
    let enabled = true;
    registerAsrHandlers({ getAppSettings: () => ({ ...emptyAppSettings, defaultAsrModel: enabled ? "sensevoice-small-int8" : null }) });
    await mock.handlers.get(ASR_CHANNELS.prepare)?.({ sender }, { requestId });
    expect(mock.prepare).toHaveBeenCalledWith(42, requestId);
    enabled = false;
    await expect(mock.handlers.get(ASR_CHANNELS.transcribe)?.({ sender }, { requestId, samples: new Float32Array(160) }))
      .resolves.toMatchObject({ status: "error" });
    expect(mock.transcribe).not.toHaveBeenCalled();
    expect(mock.cancel).toHaveBeenCalledWith(42, requestId);
  });
});


it('keeps realtime frames flowing during playback but rejects a stale sender or binding', async () => {
  const binding = { characterId: requestId, threadId: 'thread' };
  const avatar = { status: { phase: 'ready', binding, busy: false, error: null }, subscribe: vi.fn(), clearError: vi.fn(), showUserSubtitle: vi.fn() };
  registerAsrHandlers({ getAppSettings: () => ({ ...emptyAppSettings, defaultAsrModel: 'sensevoice-small-int8' }) }, avatar as unknown as import('../src/main/avatar/avatarService').AvatarService);
  const prepare = mock.handlers.get(ASR_CHANNELS.realtime)!;
  const frame = mock.handlers.get(ASR_CHANNELS.frame)!;
  await expect(prepare({ sender }, { requestId, ...binding, threadId: 'wrong' })).resolves.toMatchObject({ status: 'error' });
  await prepare({ sender }, { requestId, ...binding });
  expect(mock.prepare).toHaveBeenCalledWith(42, requestId, true);
  const input = { requestId, samples: new Float32Array(1600) };
  await expect(frame({ sender: { ...sender, id: 43 } }, input)).resolves.toMatchObject({ status: 'cancelled' });
  avatar.status.busy = true; await frame({ sender }, input); expect(mock.frame).toHaveBeenCalledTimes(1);
  avatar.status.busy = false;
  mock.frame.mockResolvedValueOnce({ status: 'success', text: '你好。', complete: true } as { status: string; text: string });
  await frame({ sender }, input); expect(mock.frame).toHaveBeenCalledTimes(2);
  expect(avatar.showUserSubtitle).not.toHaveBeenCalled();
  avatar.status.binding = { ...binding, threadId: 'new-thread' };
  await expect(frame({ sender }, input)).resolves.toMatchObject({ status: 'cancelled' });
});


it('does not erase a new realtime lease when cancelled preparation finishes late', async () => {
  const binding = { characterId: requestId, threadId: 'thread' };
  const avatar = { status: { phase: 'ready', binding, busy: false, error: null }, subscribe: vi.fn(), clearError: vi.fn(), showUserSubtitle: vi.fn() };
  registerAsrHandlers({ getAppSettings: () => ({ ...emptyAppSettings, defaultAsrModel: 'sensevoice-small-int8' }) }, avatar as unknown as import('../src/main/avatar/avatarService').AvatarService);
  let finish!: (value: { status: string; text: string }) => void;
  mock.prepare.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const prepare = mock.handlers.get(ASR_CHANNELS.realtime)!;
  const first = prepare({ sender }, { requestId, ...binding });
  mock.events.get(ASR_CHANNELS.cancel)!({ sender }, { requestId });
  const nextId = '00000000-0000-4000-8000-000000000009';
  await prepare({ sender }, { requestId: nextId, ...binding });
  finish({ status: 'cancelled', text: '' }); await first;
  await mock.handlers.get(ASR_CHANNELS.frame)!({ sender }, { requestId: nextId, samples: new Float32Array(1600) });
  expect(mock.frame).toHaveBeenCalledWith(42, nextId, expect.any(Float32Array));
});
