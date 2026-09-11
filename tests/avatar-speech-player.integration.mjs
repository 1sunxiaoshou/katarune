import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve, join } from "node:path";

const executable = resolve("unity/KataruneAvatar/Builds/Windows/KataruneAvatar.exe");
const output = resolve(".test-dist/avatar-speech", `${Date.now()}`);
await mkdir(output, { recursive: true });
const pipe = `katarune-speech-test-${randomUUID()}`;
let socket, child;
const messages = [];
const waiters = new Set();
const wait = predicate => {
  const existing = messages.find(predicate);
  if (existing) return Promise.resolve(existing);
  return new Promise(resolve => waiters.add({ predicate, resolve }));
};
const send = value => socket.write(JSON.stringify(value) + "\n");
const server = createServer(connection => {
  socket = connection; socket.setEncoding("utf8"); let buffer = "";
  socket.on("data", data => {
    buffer += data;
    let end;
    while ((end = buffer.indexOf("\n")) >= 0) {
      const message = { ...JSON.parse(buffer.slice(0, end)), receivedAt: performance.now() };
      buffer = buffer.slice(end + 1); messages.push(message);
      for (const item of [...waiters]) if (item.predicate(message)) { waiters.delete(item); item.resolve(message); }
    }
  });
});
const timeout = setTimeout(() => { console.error("Speech Player timed out"); child?.kill(); socket?.destroy(); server.close(); process.exitCode = 1; }, 120000);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
try {
  await new Promise(resolve => server.listen(`\\\\.\\pipe\\${pipe}`, resolve));
  child = spawn(executable, ["--opaque-window", "-screen-fullscreen", "0", "-screen-width", "960", "-screen-height", "720",
    "-logFile", join(output, "player.log"), "--exit-on-error"], {
    cwd: dirname(executable), windowsHide: false, stdio: "ignore",
    env: { ...process.env, KATARUNE_AVATAR_PIPE: pipe, KATARUNE_SPEECH_CAPTURE: output,
      KATARUNE_SPEECH_CLOSEUP: process.argv.includes("--closeup") ? "1" : "0" },
  });
  const ready = await wait(m => m.type === "ready");
  await delay(500);
  const runId = randomUUID();
  const event = event => send({ type: "event", runId, speechEnabled: true, event });
  const artifacts = await Promise.all(["zh", "ja", "en"].map(async language => ({
    ...JSON.parse(await readFile(resolve(`.test-dist/lipsync-live/${language}.json`), "utf8")),
    value: resolve(`.test-dist/lipsync-live/${language}.wav`),
    ...(process.argv.includes("--calibrated") ? { profilePath: resolve(".test-dist/lipsync-live/calibrated-profile.json") } : {}),
  })));
  for (let i = 0; i < 3; i++) {
    event({ type: "text-start", id: `text-${i}` });
    event({ type: "text-delta", id: `text-${i}`, delta: artifacts[i].text });
    event({ type: "text-end", id: `text-${i}` });
    if (i === 0) {
      event({ type: "tool-input-available", toolCallId: "action-1", toolName: "avatar_action" });
      send({ id: randomUUID(), operation: "action", value: ready.capabilities.actions[0].id, toolCallId: "action-1", allowSpeech: false });
    }
  }
  // Deliberately make later audio ready first. It must remain behind the first dialogue and action.
  for (const i of [2, 1]) send({ type: "dialogue-audio", runId, dialogueId: `text-${i}`, ...artifacts[i] });
  await delay(400);
  assert.equal(messages.filter(m => m.type === "speech").length, 0);
  send({ type: "dialogue-audio", runId, dialogueId: "text-0", ...artifacts[0] });
  event({ type: "finish" });
  const drain = randomUUID(); send({ id: drain, operation: "drain", value: "" });
  assert.equal((await wait(m => m.id === drain)).ok, true);
  assert.deepEqual(messages.filter(m => m.type === "dialogue-completed").map(m => m.dialogueId), ["text-0", "text-1", "text-2"]);
  const speeches = messages.filter(m => m.type === "speech");
  assert.equal(speeches.filter(m => m.status === "completed").length, 3);
  const actionEnd = messages.find(m => m.type === "action" && m.status === "completed");
  assert.ok(actionEnd && actionEnd.receivedAt < speeches.filter(m => m.status === "started")[1].receivedAt);
  const id = randomUUID(); send({ id, operation: "speech", ...artifacts[0] });
  await wait(m => m.id === id && m.status === "started"); await delay(700);
  send({ id: randomUUID(), operation: "speech-stop", value: id });
  await wait(m => m.id === id && m.status === "cancelled");
  await delay(400);
  const replay = randomUUID(); send({ id: replay, operation: "speech", ...artifacts[1] });
  await wait(m => m.id === replay && m.status === "started");
  send({ id: randomUUID(), operation: "speech-stop", value: id }); // stale stop cannot affect replay
  await wait(m => m.id === replay && m.status === "completed");
  const cancelledRun = randomUUID();
  const beforeCancel = performance.now();
  for (const event of [{ type: "text-start", id: "cancel-auto" },
    { type: "text-delta", id: "cancel-auto", delta: artifacts[0].text }, { type: "text-end", id: "cancel-auto" }])
    send({ type: "event", runId: cancelledRun, speechEnabled: true, event });
  send({ type: "dialogue-audio", runId: cancelledRun, dialogueId: "cancel-auto", ...artifacts[0] });
  const automatic = await wait(m => m.type === "speech" && m.status === "started" && m.receivedAt > beforeCancel);
  await delay(500);
  const cancelId = randomUUID(); send({ id: cancelId, operation: "run-cancel", value: cancelledRun });
  assert.equal((await wait(m => m.id === cancelId)).ok, true);
  await wait(m => m.id === automatic.id && m.status === "cancelled");
  const fallbackRun = randomUUID();
  for (const event of [{ type: "text-start", id: "fallback" }, { type: "text-delta", id: "fallback", delta: "语音失败后继续文字。" },
    { type: "text-end", id: "fallback" }, { type: "finish" }]) send({ type: "event", runId: fallbackRun, speechEnabled: true, event });
  send({ type: "dialogue-audio", runId: fallbackRun, dialogueId: "fallback", failed: true });
  const fallbackDrain = randomUUID(); send({ id: fallbackDrain, operation: "drain", value: "" });
  assert.equal((await wait(m => m.id === fallbackDrain)).ok, true);
  // Finished chat turns can leave resource fences queued behind slow synthesis.
  const queuedRuns = [randomUUID(), randomUUID()];
  const queuedDrains = [];
  for (const queuedRun of queuedRuns) {
    for (const event of [{ type: "text-start", id: "waiting" },
      { type: "text-delta", id: "waiting", delta: "等待合成。" }, { type: "text-end", id: "waiting" }])
      send({ type: "event", runId: queuedRun, speechEnabled: true, event });
    const id = randomUUID(); queuedDrains.push(id);
    send({ id, operation: "drain", value: "" });
  }
  const clearQueue = randomUUID();
  send({ id: clearQueue, operation: "run-cancel", value: queuedRuns[1] });
  assert.equal((await wait(m => m.id === clearQueue)).ok, true);
  for (const id of queuedDrains) assert.equal((await wait(m => m.id === id)).ok, true);
  if (process.argv.includes("--expressions")) for (const expression of ready.capabilities.expressions) {
    const expressionId = randomUUID();
    event({ type: "tool-input-available", toolCallId: expressionId, toolName: "set_expression" });
    send({ id: expressionId, operation: "expression", value: expression, toolCallId: expressionId });
    await wait(m => m.id === expressionId && m.type === "expression");
    const speechId = randomUUID(); send({ id: speechId, operation: "speech", ...artifacts[0] });
    await wait(m => m.id === speechId && m.status === "completed");
  }
  await delay(500);
  await writeFile(join(output, "events.json"), JSON.stringify(messages, null, 2));
  const startedIds = messages.filter(m => m.type === "speech" && m.status === "started").map(m => m.id);
  const fixtureOrder = [artifacts[0], artifacts[1], artifacts[2], artifacts[0], artifacts[1], artifacts[0], ...ready.capabilities.expressions.map(() => artifacts[0])];
  await writeFile(join(output, "speech-fixtures.json"), JSON.stringify(Object.fromEntries(startedIds.map((id, i) => [id, fixtureOrder[i]]))));
  console.log(JSON.stringify({ passed: true, output, dialogueOrder: ["zh", "action", "ja", "en"], cancellation: true, automaticCancellation: true, failureFallback: true, replay: true }));
} finally {
  clearTimeout(timeout); socket?.destroy(); server.close(); child?.kill();
}
