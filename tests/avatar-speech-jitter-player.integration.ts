import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer, type Socket } from "node:net";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve, join } from "node:path";
import { createAvatarSpeechStream } from "../src/main/avatar/avatarSpeechStream";
import { alignOriginalSubtitles } from "../src/main/speech/subtitleAlignment";
import type { SpeechSegment } from "../src/shared/speechTiming";

// Replay captured provider arrival times against the actual Unity AudioSource.
// Only local, fixed test speech is used; no provider call or credential is needed here.
const fixtureRoot = resolve(process.argv[2] ?? ".test-dist/fish-streaming-live");
const output = resolve(".test-dist/speech-jitter-player", String(Date.now()));
await mkdir(output, { recursive: true });
const executable = resolve("unity/KataruneAvatar/Builds/Windows/KataruneAvatar.exe");
const assets = join(dirname(executable), "KataruneAvatar_Data/KataruneLocal");
const manifest = JSON.parse(await readFile(join(assets, "manifest.json"), "utf8"));
const packageFile = join(output, "package.json");
const ids = JSON.parse(await readFile(join(assets, "action-ids.json"), "utf8"));
const idleAction = manifest.actions.find((a: { key: string }) => a.key === manifest.idle.base);
await writeFile(packageFile, JSON.stringify({ formatVersion: 3, id: "builtin:default", version: manifest.version,
  model: join(assets, manifest.model), idle: { base: ids[idleAction.key], variations: [] }, bindings: [],
  actions: [{ ...idleAction, id: ids[idleAction.key], playback: { ...idleAction.playback, motion: join(assets, idleAction.playback.motion) } }] }));
type Message = { type?: string; id?: string; status?: string; receivedAt: number };
const messages: Message[] = [];
let socket: Socket | undefined, child: ChildProcess | undefined;
const pipe = `katarune-jitter-test-${randomUUID()}`;
const lifetime = new AbortController();
const delay = (ms: number) => new Promise(done => setTimeout(done, Math.max(0, ms)));
async function wait(predicate: (message: Message) => boolean) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) { const found = messages.find(predicate); if (found) return found; await delay(10); }
  throw new Error("Player speech replay timed out.");
}
const send = (value: unknown) => socket!.write(JSON.stringify(value) + "\n");
const server = createServer(connection => {
  socket = connection; socket.setEncoding("utf8"); let pending = "";
  socket.on("data", chunk => {
    pending += chunk; let end: number;
    while ((end = pending.indexOf("\n")) >= 0) {
      messages.push({ ...JSON.parse(pending.slice(0, end)), receivedAt: performance.now() });
      pending = pending.slice(end + 1);
    }
  });
});
const transfer = await createAvatarSpeechStream(lifetime.signal);
const timeout = setTimeout(() => { lifetime.abort(); child?.kill(); socket?.destroy(); }, 90_000);
try {
  await new Promise<void>(done => server.listen(`\\\\.\\pipe\\${pipe}`, done));
  child = spawn(executable, ["--opaque-window", "-screen-fullscreen", "0", "-screen-width", "480", "-screen-height", "360",
    "-logFile", join(output, "player.log")], { cwd: dirname(executable), windowsHide: true, stdio: "ignore",
    env: { ...process.env, KATARUNE_CHARACTER_PACKAGE: packageFile, KATARUNE_AVATAR_PIPE: pipe,
      KATARUNE_SPEECH_CAPTURE: output, KATARUNE_CAPTURE_FPS: "20" } });
  await wait(m => m.type === "ready");
  const wav = await readFile(join(fixtureRoot, "speech.wav"));
  assert.equal(wav.toString("ascii", 36, 40), "data");
  const pcm = wav.subarray(44), sampleRate = wav.readUInt32LE(24);
  const fixture = JSON.parse(await readFile(join(fixtureRoot, "events.json"), "utf8")) as {
    text: string; events: { type: string; elapsedMs: number; bytes?: number; segments?: SpeechSegment[] }[];
  };
  const runId = randomUUID();
  for (const event of [{ type: "text-start", id: "speech" }, { type: "text-delta", id: "speech", delta: fixture.text },
    { type: "text-end", id: "speech" }, { type: "finish" }]) send({ type: "event", runId, speechEnabled: true, event });
  const filePlayback = process.argv.includes("--file");
  send({ type: "dialogue-audio", runId, dialogueId: "speech", streaming: !filePlayback,
    value: filePlayback ? join(fixtureRoot, "speech.wav") : transfer.name, text: fixture.text,
    segments: filePlayback ? alignOriginalSubtitles(fixture.text, fixture.events.filter(event => event.type === "alignment").at(-1)?.segments) ?? [] : [] });
  if (!filePlayback) await transfer.write({ type: "format", sampleRate, channels: 1, encoding: "pcm-s16le" });
  const begin = performance.now(); let offset = 0;
  const firstAudio = fixture.events.find(event => event.type === "audio")!.elapsedMs;
  let discardedAlignments = 0;
  for (const event of filePlayback ? [] : fixture.events.filter(event => ["audio", "alignment", "end"].includes(event.type))) {
    await delay(event.elapsedMs - firstAudio - (performance.now() - begin));
    if (event.type === "audio") {
      await transfer.write({ type: "audio", audio: pcm.subarray(offset, offset + event.bytes!) });
      offset += event.bytes!;
    } else if (event.type === "alignment") {
      const segments = alignOriginalSubtitles(fixture.text, event.segments, true) ?? [];
      if (!segments.length) discardedAlignments++;
      await transfer.write({ type: "alignment", segments });
    } else {
      const finalSegments = fixture.events.filter(item => item.type === "alignment").at(-1)?.segments;
      if (finalSegments?.some(segment => segment.endSeconds > pcm.length / (sampleRate * 2) + .05)) {
        discardedAlignments++;
        await transfer.write({ type: "alignment", segments: [] });
      }
      await transfer.write({ type: "end" });
    }
  }
  if (!filePlayback) assert.equal(offset, pcm.length);
  const started = await wait(m => m.type === "speech" && m.status === "started");
  const completed = await wait(m => m.id === started.id && m.status === "completed");
  await delay(200);
  await new Promise<void>(done => { child!.once("exit", () => done()); child!.kill(); });
  const frames = (await readFile(join(output, "frames.jsonl"), "utf8")).trim().split("\n").map(line => JSON.parse(line)) as {
    playbackId: string; position: number; time: number; subtitle: string;
  }[];
  const activeFrames = frames.filter(frame => frame.playbackId === started.id);
  const voiced = activeFrames.filter(frame => frame.position > .05 && frame.position < pcm.length / (sampleRate * 2) - .05);
  const freezes: number[] = []; let frozenAt: number | undefined;
  for (let i = 1; i < voiced.length; i++) {
    if (voiced[i]!.position - voiced[i - 1]!.position < .001) frozenAt ??= voiced[i - 1]!.time;
    else if (frozenAt != null) { freezes.push((voiced[i - 1]!.time - frozenAt) * 1000); frozenAt = undefined; }
  }
  assert.ok(voiced.length > 10, "actual Player clock must be captured");
  const normalize = (text: string) => text.replace(/\s/g, "");
  const text = normalize(fixture.text);
  let lastSubtitleOffset = -1, subtitleRegressions = 0, subtitleChanges = 0, lastSubtitle = "", subtitleBlanks = 0;
  for (const frame of activeFrames) {
    if (!frame.subtitle) { if (lastSubtitle) subtitleBlanks++; continue; }
    if (frame.subtitle === lastSubtitle) continue;
    const offset = text.indexOf(normalize(frame.subtitle));
    assert.ok(offset >= 0, "subtitle must preserve the original text");
    if (offset < lastSubtitleOffset) subtitleRegressions++;
    lastSubtitleOffset = offset; lastSubtitle = frame.subtitle; subtitleChanges++;
  }
  const finalEnd = fixture.events.filter(event => event.type === "alignment").at(-1)?.segments?.at(-1)?.endSeconds;
  const afterSegmentEnd = finalEnd == null ? [] : activeFrames.filter(frame => frame.position >= finalEnd + .02);
  const finalPageClearedAtEnd = afterSegmentEnd.length ? afterSegmentEnd.every(frame => frame.subtitle === "") : null;
  const subtitlesCleared = frames.at(-1)?.subtitle === "" && !frames.at(-1)?.playbackId;
  const summary = { output, durationMs: pcm.length / (sampleRate * 2) * 1000,
    startupAfterFirstAudioMs: started.receivedAt - begin, playbackElapsedMs: completed.receivedAt - started.receivedAt,
    clockFreezesMs: freezes.filter(ms => ms >= 40), discardedAlignments, subtitleChanges, subtitleRegressions,
    subtitleBlanks, finalPageClearedAtEnd, subtitlesCleared };
  await writeFile(join(output, "summary.json"), JSON.stringify(summary, null, 2));
  if (process.argv.includes("--expect-subtitles")) {
    assert.ok(subtitleChanges > 1, "fixture must exercise subtitle page transitions");
    assert.equal(subtitleRegressions, 0, "subtitle pages must not rewind during playback");
    assert.notEqual(finalPageClearedAtEnd, false, "the final subtitle must clear at its segment end");
    assert.ok(subtitlesCleared, "playback completion must clear subtitles");
  }
  if (process.argv.includes("--expect-continuous")) {
    assert.deepEqual(summary.clockFreezesMs, [], "provider trace must play continuously");
    const log = await readFile(join(output, "player.log"), "utf8");
    if (!filePlayback) assert.match(log, /KATARUNE_PCM_PLAYBACK status=completed .* underruns=0 /);
  }
  console.log(JSON.stringify(summary));
} finally {
  clearTimeout(timeout); lifetime.abort(); transfer.dispose(); socket?.destroy(); server.close(); child?.kill();
}
