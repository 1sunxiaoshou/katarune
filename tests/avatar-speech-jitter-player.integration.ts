import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer, type Socket } from "node:net";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve, join } from "node:path";
import { createAvatarSpeechStream } from "../src/main/avatar/avatarSpeechStream";

// Replay captured provider arrival times against the actual Unity AudioSource.
// Only local, fixed test speech is used; no provider call or credential is needed here.
const fixtureRoot = resolve(process.argv[2] ?? ".test-dist/fish-streaming-live");
const output = resolve(".test-dist/speech-jitter-player", String(Date.now()));
await mkdir(output, { recursive: true });
const executable = resolve("unity/KataruneAvatar/Builds/Windows/KataruneAvatar.exe");
const assets = join(dirname(executable), "KataruneAvatar_Data/KataruneLocal");
const manifest = JSON.parse(await readFile(join(assets, "manifest.json"), "utf8"));
const packageFile = join(output, "package.json");
await writeFile(packageFile, JSON.stringify({ formatVersion: 2, id: "builtin:default", version: manifest.version,
  model: join(assets, "Models/default-avatar.vrm"), idle: join(assets, manifest.systemActions.idle.file),
  idleVariations: [], customActions: [], systemBehaviors: [] }));
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
    text: string; events: { type: string; elapsedMs: number; bytes?: number }[];
  };
  const runId = randomUUID();
  for (const event of [{ type: "text-start", id: "speech" }, { type: "text-delta", id: "speech", delta: fixture.text },
    { type: "text-end", id: "speech" }, { type: "finish" }]) send({ type: "event", runId, speechEnabled: true, event });
  send({ type: "dialogue-audio", runId, dialogueId: "speech", streaming: true, value: transfer.name, text: fixture.text });
  await transfer.write({ type: "format", sampleRate, channels: 1, encoding: "pcm-s16le" });
  const begin = performance.now(); let offset = 0;
  const firstAudio = fixture.events.find(event => event.type === "audio")!.elapsedMs;
  for (const event of fixture.events.filter(event => event.type === "audio" || event.type === "end")) {
    await delay(event.elapsedMs - firstAudio - (performance.now() - begin));
    if (event.type === "audio") {
      await transfer.write({ type: "audio", audio: pcm.subarray(offset, offset + event.bytes!) });
      offset += event.bytes!;
    } else await transfer.write({ type: "end" });
  }
  assert.equal(offset, pcm.length);
  const started = await wait(m => m.type === "speech" && m.status === "started");
  const completed = await wait(m => m.id === started.id && m.status === "completed");
  await delay(200);
  await new Promise<void>(done => { child!.once("exit", () => done()); child!.kill(); });
  const frames = (await readFile(join(output, "frames.jsonl"), "utf8")).trim().split("\n").map(line => JSON.parse(line)) as {
    playbackId: string; position: number; time: number;
  }[];
  const voiced = frames.filter(frame => frame.playbackId === started.id && frame.position > .05 && frame.position < pcm.length / (sampleRate * 2) - .05);
  const freezes: number[] = []; let frozenAt: number | undefined;
  for (let i = 1; i < voiced.length; i++) {
    if (voiced[i]!.position - voiced[i - 1]!.position < .001) frozenAt ??= voiced[i - 1]!.time;
    else if (frozenAt != null) { freezes.push((voiced[i - 1]!.time - frozenAt) * 1000); frozenAt = undefined; }
  }
  assert.ok(voiced.length > 10, "actual Player clock must be captured");
  const summary = { output, durationMs: pcm.length / (sampleRate * 2) * 1000,
    startupAfterFirstAudioMs: started.receivedAt - begin, playbackElapsedMs: completed.receivedAt - started.receivedAt,
    clockFreezesMs: freezes.filter(ms => ms >= 40) };
  if (process.argv.includes("--expect-continuous")) {
    assert.deepEqual(summary.clockFreezesMs, [], "provider trace must play continuously");
    const log = await readFile(join(output, "player.log"), "utf8");
    assert.match(log, /KATARUNE_PCM_PLAYBACK status=completed .* underruns=0 /);
  }
  await writeFile(join(output, "summary.json"), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary));
} finally {
  clearTimeout(timeout); lifetime.abort(); transfer.dispose(); socket?.destroy(); server.close(); child?.kill();
}
