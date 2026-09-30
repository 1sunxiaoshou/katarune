import { expect, it, vi } from "vitest";
import { AvatarDialogueSpeech } from "../src/main/avatar/avatarDialogueSpeech";
import type { SpeechService } from "../src/main/speech/ttsService";

it("starts only closed public text, limits prefetch, and resumes on Unity completion", async () => {
  const generate = vi.fn(async () => ({ audio: new Uint8Array([1]), format: "wav", mediaType: "audio/wav" as const, cacheHit: false }));
  const send = vi.fn();
  const run = new AvatarDialogueSpeech("run", "character", { generate }, send);
  try {
    run.observe({ type: "reasoning-start", id: "reason" });
    run.observe({ type: "reasoning-delta", id: "reason", delta: "private" });
    for (const id of ["one", "two", "three"]) {
      run.observe({ type: "text-start", id });
      run.observe({ type: "text-delta", id, delta: id });
      if (id === "one") expect(generate).not.toHaveBeenCalled();
      run.observe({ type: "text-end", id });
    }
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    expect(generate).toHaveBeenCalledTimes(2);
    expect(generate.mock.calls.flat()).not.toContain("private");
    run.completed("one");
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(3));
  } finally { await run.dispose(); }
});

it("does not synthesize an aborted unfinished text block", async () => {
  const generate = vi.fn(); const send = vi.fn();
  const run = new AvatarDialogueSpeech("run", "character", { generate }, send);
  run.observe({ type: "text-start", id: "partial" });
  run.observe({ type: "text-delta", id: "partial", delta: "unfinished" });
  run.observe({ type: "abort" });
  run.seal();
  expect(generate).not.toHaveBeenCalled();
  expect(send).toHaveBeenCalledWith(expect.objectContaining({ failed: true }));
  await run.dispose();
});

it.skipIf(process.platform !== "win32")("cancels streaming admission while Unity has not reached the dialogue", async () => {
  const generate: SpeechService["generate"] = async (_character, text, _signal, _timing, sink) => {
    await sink!({ type: "format", sampleRate: 24000, channels: 1, encoding: "pcm-s16le" }, { text, profilePath: undefined });
    throw new Error("Cancelled admission must not continue synthesis.");
  };
  const send = vi.fn();
  const run = new AvatarDialogueSpeech("run", "character", { generate }, send);
  try {
    run.observe({ type: "text-start", id: "waiting" });
    run.observe({ type: "text-delta", id: "waiting", delta: "等待播放。" });
    run.observe({ type: "text-end", id: "waiting" });
    await vi.waitFor(() => expect(send).toHaveBeenCalledWith(expect.objectContaining({
      type: "dialogue-audio", runId: "run", dialogueId: "waiting", streaming: true,
    })));
  } finally { await run.dispose(); }
  expect(send).toHaveBeenCalledTimes(1);
});
