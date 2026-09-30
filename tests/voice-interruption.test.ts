import { describe, expect, it, vi } from "vitest";
import { interruptForVoice } from "../src/renderer/src/chat/voiceInterruption";

describe("voice interruption generation deadline", () => {
  it("keeps the complete reply when generation finishes within ten seconds", async () => {
    let generating = true;
    let elapsed = 0;
    const stop = vi.fn(async () => {});
    const mark = vi.fn();
    const enqueue = vi.fn(async () => {});
    await interruptForVoice({ enqueue, isGenerating: () => generating, stopGeneration: stop,
      markReply: mark, now: () => elapsed, delay: async milliseconds => { elapsed += milliseconds; if (elapsed >= 300) generating = false; } });
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(stop).not.toHaveBeenCalled();
    expect(mark).toHaveBeenCalledExactlyOnceWith(false);
  });

  it("cancels generation at ten seconds and marks the preserved partial reply", async () => {
    let elapsed = 0;
    const stop = vi.fn(async () => {});
    const mark = vi.fn();
    await interruptForVoice({ enqueue: async () => {}, isGenerating: () => true,
      stopGeneration: stop, markReply: mark, now: () => elapsed,
      delay: async milliseconds => { elapsed += milliseconds; } });
    expect(elapsed).toBe(10_000);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(mark).toHaveBeenCalledExactlyOnceWith(true);
  });

  it("marks already completed playback without stopping the model", async () => {
    const stop = vi.fn(async () => {});
    const mark = vi.fn();
    await interruptForVoice({ enqueue: async () => {}, isGenerating: () => false,
      stopGeneration: stop, markReply: mark });
    expect(stop).not.toHaveBeenCalled();
    expect(mark).toHaveBeenCalledExactlyOnceWith(false);
  });
});
