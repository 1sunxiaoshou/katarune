import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  KataruneApi,
  SpeechGenerateRequest,
  SpeechGenerateResponse,
} from "../src/shared/ipc";

const { notify } = vi.hoisted(() => ({ notify: vi.fn() }));
vi.mock("../src/renderer/src/notifications/notificationCenter", () => ({ notify }));

import { KataruneSpeechSynthesisAdapter } from "../src/renderer/src/speech/KataruneSpeechSynthesisAdapter";

const characterId = "00000000-0000-4000-8000-000000000001";

class MockAudio {
  public static readonly instances: MockAudio[] = [];
  public onended: (() => void) | null = null;
  public onerror: (() => void) | null = null;
  public readonly pause = vi.fn();
  public readonly load = vi.fn();
  public readonly removeAttribute = vi.fn();
  public readonly play = vi.fn(async () => undefined);

  public constructor(public readonly src: string) {
    MockAudio.instances.push(this);
  }
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("assistant-ui TTS adapter", () => {
  const cancelSpeech = vi.fn();
  const createObjectURL = vi.fn((_blob: Blob) => "blob:katarune");
  const revokeObjectURL = vi.fn();
  let adapter: KataruneSpeechSynthesisAdapter;

  beforeEach(() => {
    MockAudio.instances.length = 0;
    notify.mockReset();
    cancelSpeech.mockReset();
    createObjectURL.mockClear();
    revokeObjectURL.mockReset();
    vi.stubGlobal("Audio", MockAudio);
    vi.stubGlobal("URL", {
      createObjectURL,
      revokeObjectURL,
    });
  });

  afterEach(() => {
    adapter?.dispose();
    vi.unstubAllGlobals();
  });

  it("moves from starting to running and releases playback resources", async () => {
    const response = deferred<SpeechGenerateResponse>();
    const generateSpeech = vi.fn(
      (_request: SpeechGenerateRequest) => response.promise,
    );
    vi.stubGlobal("window", {
      katarune: { generateSpeech, cancelSpeech } as Partial<KataruneApi>,
    });
    adapter = new KataruneSpeechSynthesisAdapter(characterId);

    const utterance = adapter.speak("需要朗读");
    expect(utterance.status).toEqual({ type: "starting" });
    const requestId = generateSpeech.mock.calls[0]?.[0]?.requestId;
    expect(requestId).toBeTypeOf("string");
    response.resolve({
      status: "success",
      requestId: requestId!,
      audio: new Uint8Array([0x52, 0x49, 0x46, 0x46]),
      format: "wav",
      mediaType: "audio/wav",
      cacheHit: false,
    });
    await flush();

    expect(utterance.status).toEqual({ type: "running" });
    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect((createObjectURL.mock.calls[0]?.[0] as Blob).type).toBe("audio/wav");
    const audio = MockAudio.instances[0]!;
    audio.onended?.();
    expect(utterance.status).toEqual({
      type: "ended",
      reason: "finished",
    });
    expect(audio.pause).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:katarune");
  });

  it("cancels synthesis and ignores a late success response", async () => {
    const response = deferred<SpeechGenerateResponse>();
    const generateSpeech = vi.fn(
      (_request: SpeechGenerateRequest) => response.promise,
    );
    vi.stubGlobal("window", {
      katarune: { generateSpeech, cancelSpeech } as Partial<KataruneApi>,
    });
    adapter = new KataruneSpeechSynthesisAdapter(characterId);

    const utterance = adapter.speak("停止");
    const requestId = generateSpeech.mock.calls[0]?.[0]?.requestId;
    utterance.cancel();
    response.resolve({
      status: "success",
      requestId: requestId!,
      audio: new Uint8Array([0x49, 0x44, 0x33]),
      format: "mp3",
      mediaType: "audio/mpeg",
      cacheHit: false,
    });
    await flush();

    expect(cancelSpeech).toHaveBeenCalledWith({ requestId });
    expect(utterance.status).toEqual({
      type: "ended",
      reason: "cancelled",
    });
    expect(MockAudio.instances).toHaveLength(0);
  });

  it("cancels the previous message across adapter instances", () => {
    const generateSpeech = vi.fn(
      (_request: SpeechGenerateRequest) =>
        new Promise<SpeechGenerateResponse>(() => undefined),
    );
    vi.stubGlobal("window", {
      katarune: { generateSpeech, cancelSpeech } as Partial<KataruneApi>,
    });
    adapter = new KataruneSpeechSynthesisAdapter(characterId);
    const first = adapter.speak("第一条");
    const secondAdapter = new KataruneSpeechSynthesisAdapter(characterId);

    const second = secondAdapter.speak("第二条");

    expect(first.status).toMatchObject({
      type: "ended",
      reason: "cancelled",
    });
    expect(second.status).toEqual({ type: "starting" });
    secondAdapter.dispose();
  });

  it("reports errors and allows a click retry", async () => {
    const generateSpeech = vi
      .fn()
      .mockImplementationOnce(async ({ requestId }) => ({
        status: "error",
        requestId,
        code: "provider-error",
        message: "供应商错误",
      }))
      .mockImplementationOnce(
        () => new Promise<SpeechGenerateResponse>(() => undefined),
      );
    vi.stubGlobal("window", {
      katarune: { generateSpeech, cancelSpeech } as Partial<KataruneApi>,
    });
    adapter = new KataruneSpeechSynthesisAdapter(characterId);

    const failed = adapter.speak("失败");
    await flush();
    expect(failed.status).toMatchObject({ type: "ended", reason: "error" });
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ message: "朗读失败，请重试。" }),
    );

    const retry = adapter.speak("失败");
    expect(retry.status).toEqual({ type: "starting" });
    expect(generateSpeech).toHaveBeenCalledTimes(2);
  });
});
