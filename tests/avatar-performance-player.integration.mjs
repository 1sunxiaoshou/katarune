import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const executable = resolve(process.argv[2] ?? "unity/KataruneAvatar/Builds/Windows/KataruneAvatar.exe");
const output = resolve(".test-dist/avatar-performance", String(Date.now()));
await mkdir(output, { recursive: true });
const root = join(dirname(executable), "KataruneAvatar_Data/KataruneLocal");
const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));
const playback = source => Object.fromEntries(Object.entries(source).map(([key, value]) =>
  [key, ["file", "enter", "loop", "exit", "reference"].includes(key) ? join(root, value) : value]));
const pack = { formatVersion: 2, id: "builtin:default", version: manifest.version, model: join(root, "Models/default-avatar.vrm"),
  idle: join(root, manifest.systemActions.idle.file), idleVariations: [], customActions: [],
  systemBehaviors: ["greet", "nod", "clap", "talk"].map(name => ({ id: `system.${name}`, name, playback: playback(manifest.systemActions[name]) })) };
const packageFile = join(output, "package.json");
await writeFile(packageFile, JSON.stringify(pack));
// Six seconds of silence exercise the real AudioSource clock without producing a test tone.
const rate = 24000, wav = Buffer.alloc(44 + rate * 6 * 2);
wav.write("RIFF"); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
wav.write("data", 36); wav.writeUInt32LE(wav.length - 44, 40);
const audio = join(output, "silence.wav"); await writeFile(audio, wav);
const messages = [];
let socket, child;
const pipe = `katarune-performance-test-${randomUUID()}`;
const server = createServer(connection => {
  socket = connection; connection.setEncoding("utf8"); let buffer = "";
  connection.on("data", data => {
    buffer += data; let end;
    while ((end = buffer.indexOf("\n")) >= 0) {
      messages.push({ ...JSON.parse(buffer.slice(0, end)), received: performance.now() }); buffer = buffer.slice(end + 1);
    }
  });
});
const send = value => socket.write(JSON.stringify(value) + "\n");
const delay = ms => new Promise(resolveDelay => setTimeout(resolveDelay, ms));
async function wait(predicate) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) { const found = messages.find(predicate); if (found) return found; await delay(20); }
  throw new Error("Player timeout: " + JSON.stringify(messages.slice(-6)));
}
function event(runId, event) { send({ type: "event", runId, speechEnabled: true, event }); }
async function submit(runId, steps, commandFirst = false) {
  const id = randomUUID();
  const command = () => send({ id, operation: "performance", value: JSON.stringify({ steps }), toolCallId: id });
  if (commandFirst) command();
  event(runId, { type: "tool-input-available", toolCallId: id, toolName: "avatar_perform" });
  if (!commandFirst) command();
  const result = await wait(m => m.type === "result" && m.id === id);
  assert.equal(result.ok, true, result.error);
  return id;
}
function dialogue(runId, id, withAudio = true) {
  const text = "你回来啦！今天完成了好多！接下来休息一下。";
  event(runId, { type: "text-start", id }); event(runId, { type: "text-delta", id, delta: text }); event(runId, { type: "text-end", id });
  send({ type: "dialogue-text", runId, dialogueId: id, text });
  send({ type: "dialogue-audio", runId, dialogueId: id, failed: !withAudio, value: audio, text, segments: [
    { text: "你回来啦！", startSeconds: 0, endSeconds: 2 },
    { text: "今天完成了好多！", startSeconds: 2, endSeconds: 4 },
    { text: "接下来休息一下。", startSeconds: 4, endSeconds: 6 },
  ] });
}
async function drain(runId) {
  const id = randomUUID(); send({ id, operation: "drain", value: runId });
  assert.equal((await wait(m => m.type === "result" && m.id === id)).ok, true);
}
const state = (id, predicate) => m => m.type === "performance" && m.performance.performanceId === id && predicate(m.performance);
try {
  await new Promise(done => server.listen(`\\\\.\\pipe\\${pipe}`, done));
  const env = { ...process.env, KATARUNE_CHARACTER_PACKAGE: packageFile, KATARUNE_AVATAR_PIPE: pipe,
    KATARUNE_SPEECH_CAPTURE: output, KATARUNE_CAPTURE_FPS: "10" };
  delete env.ELECTRON_RUN_AS_NODE;
  child = spawn(executable, ["--opaque-window", "-screen-fullscreen", "0", "-screen-width", "800", "-screen-height", "720", "-logFile", join(output, "player.log")],
    { cwd: dirname(executable), env, windowsHide: true, stdio: "ignore" });
  const ready = await wait(m => m.type === "ready");
  for (const name of ["happy", "surprised", "relaxed"]) assert.ok(ready.capabilities.expressions.includes(name));
  // A tool rejected in main has no Player command. Its failed placeholder must
  // release the following dialogue before the model's entire run is drained.
  for (const failure of ["tool-output-error", "tool-output-denied"]) {
    const rejectedRun = randomUUID(), rejectedTool = randomUUID();
    event(rejectedRun, { type: "tool-input-available", toolCallId: rejectedTool, toolName: "avatar_perform" });
    event(rejectedRun, { type: failure, toolCallId: rejectedTool, ...(failure === "tool-output-error" ? { errorText: "Test tool rejection" } : {}) });
    dialogue(rejectedRun, "after-rejected-tool");
    await wait(m => m.type === "speech" && m.runId === rejectedRun && m.status === "started");
    await drain(rejectedRun);
  }
  const run = randomUUID();
  const id = await submit(run, [
    { at: "start", action: "system.greet", expression: "happy" },
    { at: "after_action", action: "system.clap" },
    { at: "sentence", sentence: 2, action: "system.nod", expression: "surprised" },
    { at: "sentence", sentence: 3, expression: "relaxed" },
    { at: "sentence", sentence: 99, expression: "happy" },
  ]);
  dialogue(run, "dialogue");
  const start = await wait(m => m.type === "speech" && m.runId === run && m.status === "started");
  const second = await wait(state(id, p => p.cues[2].state === "running"));
  const third = await wait(state(id, p => p.cues[3].state === "completed"));
  assert.ok(second.received - start.received >= 1600 && second.received - start.received < 3200, "Second cue follows actual audio clock");
  assert.ok(third.received - start.received >= 3600 && third.received - start.received < 5200, "Third cue occurs during the same audio block");
  await drain(run);
  const done = await wait(state(id, p => p.state === "completed"));
  assert.deepEqual(done.performance.cues.map(c => c.state), ["completed", "completed", "completed", "completed", "skipped"]);
  for (const affect of ["happy", "surprised", "relaxed"]) assert.ok(messages.some(m => m.type === "presentation" && m.affect === affect));
  const cancelledRun = randomUUID();
  const cancelled = await submit(cancelledRun, [
    { at: "start", action: "system.talk" },
    { at: "sentence", sentence: 3, expression: "happy" },
  ], true);
  dialogue(cancelledRun, "cancel-dialogue");
  await wait(state(cancelled, p => p.state === "running"));
  const control = randomUUID();
  event(cancelledRun, { type: "tool-input-available", toolCallId: control, toolName: "avatar_control" });
  send({ id: control, operation: "performance-cancel", value: cancelled, toolCallId: control });
  await wait(state(cancelled, p => p.state === "cancelled"));
  assert.equal((await wait(m => m.type === "result" && m.id === control)).ok, true);
  await drain(cancelledRun);
  const retainedRun = randomUUID();
  const retained = await submit(retainedRun, [{ at: "start", action: "system.talk" }]);
  dialogue(retainedRun, "retained-dialogue");
  await wait(state(retained, p => p.state === "running"));
  const queuedRun = randomUUID();
  const queued = await submit(queuedRun, [{ at: "start", expression: "happy" }]);
  dialogue(queuedRun, "queued-dialogue");
  const cancelRun = randomUUID(); send({ id: cancelRun, operation: "run-cancel", value: queuedRun });
  await wait(state(queued, p => p.state === "cancelled"));
  await delay(150);
  assert.equal(messages.filter(state(retained, () => true)).at(-1).performance.state, "running", "Cancelling a queued reply preserves earlier playback");
  await drain(retainedRun); await drain(queuedRun);
  const silentRun = randomUUID();
  const silent = await submit(silentRun, [
    { at: "start", expression: "happy" },
    { at: "sentence", sentence: 2, expression: "surprised" },
    { at: "sentence", sentence: 3, expression: "relaxed" },
  ]);
  dialogue(silentRun, "silent-dialogue", false);
  await drain(silentRun);
  assert.deepEqual((await wait(state(silent, p => p.state === "completed"))).performance.cues.map(c => c.state), ["completed", "completed", "completed"]);
  const emptyRun = randomUUID();
  const empty = await submit(emptyRun, [{ at: "start", expression: "happy" }]);
  await drain(emptyRun);
  assert.equal((await wait(state(empty, p => p.state === "completed"))).performance.cues[0].state, "skipped");
  const frames = (await readFile(join(output, "frames.jsonl"), "utf8")).trim().split("\n").map(line => JSON.parse(line));
  const expressionPeaks = Object.fromEntries(["happy", "surprised", "relaxed"].map(name => [name, Math.max(...frames.map(frame => frame[name]))]));
  for (const [name, weight] of Object.entries(expressionPeaks)) assert.ok(weight > .99, `${name} must reach full semantic weight in the actual Player`);
  await writeFile(join(output, "results.json"), JSON.stringify({ passed: true, sentence2Ms: second.received - start.received, sentence3Ms: third.received - start.received, states: done.performance.cues, expressionPeaks }, null, 2));
  console.log("[performance-player] passed: rejected-tool recovery, audio anchors, action sequence, expression changes, in-flight cancellation, cross-reply isolation, silent fallback, no-dialogue cleanup");
  console.log(output);
} finally { socket?.destroy(); server.close(); child?.kill(); }
