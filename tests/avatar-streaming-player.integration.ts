import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer, type Socket } from "node:net";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve, join } from "node:path";
import { createAvatarSpeechStream } from "../src/main/avatar/avatarSpeechStream";
import { alignOriginalSubtitles } from "../src/main/speech/subtitleAlignment";

const output = resolve(".test-dist/avatar-streaming", `${Date.now()}`);
await mkdir(output, { recursive: true });
const executable = resolve("unity/KataruneAvatar/Builds/Windows/KataruneAvatar.exe");
const pipe = `katarune-stream-test-${randomUUID()}`;
let socket: Socket | undefined, child: ChildProcess | undefined;
type Message = { type?: string; id?: string; status?: string; ok?: boolean; receivedAt: number };
const messages: Message[] = [];
const waiters = new Set<{ predicate: (message: Message) => boolean; resolve: (message: Message) => void }>();
const wait = (predicate: (message: Message) => boolean): Promise<Message> => {
  const existing = messages.find(predicate);
  return existing ? Promise.resolve(existing) : new Promise(resolve => waiters.add({ predicate, resolve }));
};
const send = (value: unknown) => socket!.write(JSON.stringify(value) + "\n");
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const lifetime = new AbortController();
const transfers: Awaited<ReturnType<typeof createAvatarSpeechStream>>[] = [];
const server = createServer(connection => {
  socket = connection; socket.setEncoding("utf8"); let buffer = "";
  socket.on("data", data => {
    buffer += data;
    let end: number;
    while ((end = buffer.indexOf("\n")) >= 0) {
      const message = { ...JSON.parse(buffer.slice(0, end)), receivedAt: performance.now() } as Message;
      buffer = buffer.slice(end + 1); messages.push(message);
      for (const item of [...waiters]) if (item.predicate(message)) { waiters.delete(item); item.resolve(message); }
    }
  });
});
const timeout = setTimeout(() => { child?.kill(); socket?.destroy(); lifetime.abort(); console.error("Streaming Player timed out"); process.exit(1); }, 90000);
try {
  await new Promise<void>(resolve => server.listen(`\\\\.\\pipe\\${pipe}`, resolve));
  child = spawn(executable, ["--opaque-window", "-screen-fullscreen", "0", "-screen-width", "960", "-screen-height", "720",
    "-logFile", join(output, "player.log")], { cwd: dirname(executable), windowsHide: !process.argv.includes("--visible"), stdio: "ignore",
    env: { ...process.env, KATARUNE_AVATAR_PIPE: pipe, KATARUNE_SPEECH_CAPTURE: output } });
  await wait(m => m.type === "ready");
  const wav = await readFile(resolve(".test-dist/fish-streaming-live/speech.wav"));
  assert.equal(wav.toString("ascii", 36, 40), "data");
  const pcm = wav.subarray(44), sampleRate = wav.readUInt32LE(24);
  const fixture = JSON.parse(await readFile(resolve(".test-dist/fish-streaming-live/events.json"), "utf8"));
  const stream = await createAvatarSpeechStream(lifetime.signal); transfers.push(stream);
  const runId = randomUUID();
  for (const event of [{ type: "text-start", id: "stream" }, { type: "text-delta", id: "stream", delta: fixture.text },
    { type: "text-end", id: "stream" }, { type: "finish" }]) send({ type: "event", runId, speechEnabled: true, event });
  send({ type: "dialogue-audio", runId, dialogueId: "stream", streaming: true, value: stream.name, text: fixture.text });
  const begin = performance.now();
  await stream.write({ type: "format", sampleRate, channels: 1, encoding: "pcm-s16le" });
  const firstBytes = sampleRate; // half a second, followed by a deliberate underrun
  await stream.write({ type: "audio", audio: pcm.subarray(0, firstBytes) });
  const started = await wait(m => m.type === "speech" && m.status === "started");
  await delay(1800);
  const finalAlignment = fixture.events.filter((e: { type: string }) => e.type === "alignment").at(-1);
  await stream.write({ type: "alignment", segments: alignOriginalSubtitles(fixture.text, finalAlignment?.segments) ?? [] });
  for (let offset = firstBytes; offset < pcm.length; offset += 12000) {
    await stream.write({ type: "audio", audio: pcm.subarray(offset, offset + 12000) });
    await delay(80);
  }
  await stream.write({ type: "end" });
  const delivered = performance.now();
  assert.ok(started.receivedAt < delivered - 1500, "must start before delivery ends");
  await wait(m => m.id === started.id && m.status === "completed");
  // Cancellation must interrupt a connected stream without waiting for its end frame.
  const next = await createAvatarSpeechStream(lifetime.signal); transfers.push(next);
  const nextRun = randomUUID();
  for (const event of [{ type: "text-start", id: "cancel" }, { type: "text-delta", id: "cancel", delta: fixture.text }, { type: "text-end", id: "cancel" }])
    send({ type: "event", runId: nextRun, speechEnabled: true, event });
  send({ type: "dialogue-audio", runId: nextRun, dialogueId: "cancel", streaming: true, value: next.name, text: fixture.text });
  await next.write({ type: "format", sampleRate, channels: 1, encoding: "pcm-s16le" });
  await next.write({ type: "audio", audio: pcm.subarray(0, firstBytes) });
  const second = await wait(m => m.type === "speech" && m.status === "started" && m.id !== started.id);
  send({ id: randomUUID(), operation: "run-cancel", value: nextRun });
  await wait(m => m.id === second.id && m.status === "cancelled");
  await delay(300);
  await new Promise<void>(resolve => { child!.once("exit", () => resolve()); child!.kill(); });
  const frames = (await readFile(join(output, "frames.jsonl"), "utf8")).trim().split("\n").map(line => JSON.parse(line));
  const voiced = frames.filter(f => f.playbackId === started.id);
  assert.ok(voiced.filter(f => Math.abs(f.position - .5) < .001).length >= 5, "underrun must freeze audio clock");
  assert.ok(voiced.some(f => f.position >= pcm.length / (sampleRate * 2) - .05), "must consume final samples");
  assert.ok(voiced.some(f => Math.max(f.aa, f.ih, f.ou, f.ee, f.oh) > .05), "actual PCM must drive lipsync");
  // Compare the final voiced samples with actual AudioSource output, not the read cursor.
  const captured = await readFile(join(output, "audio.f32"));
  const outputRate = Number(await readFile(join(output, "sample-rate.txt"), "utf8"));
  const channels = JSON.parse((await readFile(join(output, "audio.jsonl"), "utf8")).split("\n")[0]!).channels as number;
  const ratio = outputRate / sampleRate;
  assert.ok(Number.isInteger(ratio), "tail check requires an integer resampling ratio");
  const source = Array.from({ length: pcm.length / 2 }, (_, i) => pcm.readInt16LE(i * 2) / 32768);
  let last = source.length - 1;
  while (last > 0 && Math.abs(source[last]!) <= .015) last--;
  const tail = source.slice(last - 511, last + 1);
  const actual = Array.from({ length: Math.floor(captured.length / (4 * channels * ratio)) }, (_, i) => captured.readFloatLE(i * 4 * channels * ratio));
  const energy = tail.reduce((sum, value) => sum + value * value, 0);
  let best = 0;
  for (let offset = 0; offset + tail.length <= actual.length; offset++) {
    let dot = 0, norm = 0;
    for (let i = 0; i < tail.length; i++) { const value = actual[offset + i]!; dot += tail[i]! * value; norm += value * value; }
    if (norm > 0) best = Math.max(best, dot / Math.sqrt(energy * norm));
  }
  assert.ok(best > .995, `final voiced samples were truncated (correlation ${best})`);
  await writeFile(join(output, "events.json"), JSON.stringify(messages, null, 2));
  console.log(JSON.stringify({ passed: true, output, firstPlaybackMs: started.receivedAt - begin, deliveryMs: delivered - begin,
    durationSeconds: pcm.length / (sampleRate * 2), underrunClock: true, cancellation: true, lipsync: true, tailCorrelation: best }));
} finally {
  clearTimeout(timeout); lifetime.abort(); for (const transfer of transfers) transfer.dispose();
  socket?.destroy(); server.close(); child?.kill();
}
