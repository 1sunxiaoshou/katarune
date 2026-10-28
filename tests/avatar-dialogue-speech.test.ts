import { expect, it, vi } from "vitest";
import { AvatarDialogueSpeech } from "../src/main/avatar/avatarDialogueSpeech";
import type { SpeechService } from "../src/main/speech/ttsService";
import { SpeechServiceError } from "../src/main/speech/ttsService";

it("starts only admitted closed public text, bounds resources, and resumes on Unity completion", async () => {
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
    expect(generate).not.toHaveBeenCalled();
    for (const id of ["one", "two", "three"]) run.admit(id, "spoken");
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

it.each(["", " \n", "![图片](image.png)", "```js\nconst a = 1;\n```"])("releases non-spoken content without reporting a synthesis failure: %s", async text => {
  const generate = vi.fn(), send = vi.fn(), onFailure = vi.fn();
  const run = new AvatarDialogueSpeech("run", "character", { generate }, send, undefined, onFailure);
  try {
    run.observe({ type: "text-start", id: "empty" });
    run.observe({ type: "text-delta", id: "empty", delta: text });
    run.observe({ type: "text-end", id: "empty" });
    run.admit("empty", "spoken");
    await vi.waitFor(() => expect(send).toHaveBeenCalledWith(expect.objectContaining({ dialogueId: "empty", failed: true, text: "" })));
    expect(generate).not.toHaveBeenCalled();
    expect(onFailure).not.toHaveBeenCalled();
  } finally { await run.dispose(); }
});

it("retains the cause of synthesis failure while releasing dialogue for silent fallback", async () => {
  const failure = new SpeechServiceError("not-configured", "该角色尚未配置语音模型。");
  const send = vi.fn(), onFailure = vi.fn();
  const run = new AvatarDialogueSpeech("run", "character", { generate: vi.fn().mockRejectedValue(failure) }, send, undefined, onFailure);
  try {
    run.observe({ type: "text-start", id: "intro" });
    run.observe({ type: "text-delta", id: "intro", delta: "准备开始。" });
    run.observe({ type: "text-end", id: "intro" });
    run.admit("intro", "spoken");
    await vi.waitFor(() => expect(onFailure).toHaveBeenCalledWith(failure, undefined));
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ dialogueId: "intro", failed: true }));
  } finally { await run.dispose(); }
});

it.skipIf(process.platform !== "win32")("cancels an admitted streaming pipe before the audio consumer connects", async () => {
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
    run.admit("waiting", "spoken");
    await vi.waitFor(() => expect(send).toHaveBeenCalledWith(expect.objectContaining({
      type: "dialogue-audio", runId: "run", dialogueId: "waiting", streaming: true,
    })));
  } finally { await run.dispose(); }
  expect(send).toHaveBeenCalledTimes(1);
});
