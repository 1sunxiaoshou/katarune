import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve, join } from "node:path";

// Requires a built Windows Player and the local default VRM/motion pack.
const executable = resolve(
  "unity/KataruneAvatar/Builds/Windows/KataruneAvatar.exe",
);
assert.ok(existsSync(executable), "Build the Unity Windows Player first");
const output = resolve(".test-dist/avatar-player");
mkdirSync(output, { recursive: true });
const capturePath = join(output, `subtitles-${Date.now()}.png`);
const pipe = `katarune-avatar-test-${randomUUID()}`;
const pending = new Map();
const actionEvents = [];
const expressionEvents = [];
const allowSpeech = !process.argv.includes("--silent-action");
let socket;
let child;
let reportReady;
const ready = new Promise((resolve) => {
  reportReady = resolve;
});
const server = createServer((connection) => {
  socket = connection;
  connection.setEncoding("utf8");
  let buffer = "";
  connection.on("data", (chunk) => {
    buffer += chunk;
    let end;
    while ((end = buffer.indexOf("\n")) >= 0) {
      const message = JSON.parse(buffer.slice(0, end));
      buffer = buffer.slice(end + 1);
      if (message.type === "ready") reportReady(message.capabilities);
      else if (message.type === "action")
        actionEvents.push({ ...message, receivedAt: performance.now() });
      else if (message.type === "expression")
        expressionEvents.push({ ...message, receivedAt: performance.now() });
      else {
        pending.get(message.id)?.(message);
        pending.delete(message.id);
      }
    }
  });
});
const timeout = setTimeout(() => {
  console.error("Avatar Player test timed out");
  cleanup();
  process.exitCode = 1;
}, 60_000);
function cleanup() {
  clearTimeout(timeout);
  socket?.destroy();
  server.close();
  child?.kill();
}
function request(operation, value, toolCallId = "") {
  const id = randomUUID();
  const result = new Promise((resolve) => pending.set(id, resolve));
  socket.write(
    JSON.stringify({ id, operation, value, allowSpeech, toolCallId }) + "\n",
  );
  return result;
}

try {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(`\\\\.\\pipe\\${pipe}`, resolve);
  });
  child = spawn(
    executable,
    [
      "-logFile",
      join(output, "player.log"),
      "--screenshot",
      capturePath,
      "--capture-delay",
      "1.5",
      "--exit-on-error",
    ],
    {
      cwd: dirname(executable),
      windowsHide: true,
      stdio: "ignore",
      env: { ...process.env, KATARUNE_AVATAR_PIPE: pipe },
    },
  );
  const caps = await ready;
  assert.ok(caps.actions.some((a) => a.id === "right-hand-open"));
  assert.ok(caps.expressions.includes("happy"));
  const started = performance.now();
  const completed = {};
  const invoke = async (operation, value, toolCallId) => {
    const reply = await request(operation, value, toolCallId);
    completed[operation] = Math.round(performance.now() - started);
    assert.equal(reply.ok, true, reply.error);
  };
  const event = (event) =>
    socket.write(JSON.stringify({ type: "event", event }) + "\n");
  event({ type: "start", messageId: "test" });
  event({ type: "start-step" });
  event({ type: "reasoning-start", id: "reason" });
  event({
    type: "reasoning-delta",
    id: "reason",
    delta: "这段推理不应该显示在字幕。",
  });
  event({ type: "reasoning-end", id: "reason" });
  event({ type: "text-start", id: "text" });
  event({
    type: "text-delta",
    id: "text",
    delta: "\n\n呼——总算动起来了！\n\n老师，现在文本会直接显示为字幕。",
  });
  event({ type: "text-end", id: "text" });
  const expressionToolCallId = randomUUID();
  const actionToolCallId = randomUUID();
  event({
    type: "tool-input-available",
    toolCallId: expressionToolCallId,
    toolName: "set_expression",
    input: { expression: "happy" },
  });
  event({
    type: "tool-input-available",
    toolCallId: actionToolCallId,
    toolName: "avatar_action",
    input: { action: "right-hand-open", allowSpeech },
  });
  const actions = Promise.all([
    invoke("action", "right-hand-open", actionToolCallId),
    invoke("expression", "happy", expressionToolCallId),
  ]);
  event({ type: "finish-step" });
  // Providers can reuse text IDs in a later step while earlier subtitles still play.
  event({ type: "start-step" });
  event({ type: "text-start", id: "text" });
  event({
    type: "text-delta",
    id: "text",
    delta: "动作和对白由 Unity 按事件顺序编排，后续再接入语音。",
  });
  event({ type: "text-end", id: "text" });
  event({ type: "finish-step" });
  event({ type: "finish", finishReason: "stop" });
  await Promise.all([actions, invoke("drain", "")]);
  assert.ok(
    completed.expression < 1000,
    "Expression acceptance must not wait for playback",
  );
  assert.ok(
    completed.action < completed.drain,
    "Action acceptance must precede timeline drain",
  );
  assert.ok(
    completed.drain >= 7000,
    "Stream completion must wait for subtitle playback",
  );
  const actionStart = actionEvents.find((e) => e.status === "started");
  const actionEnd = actionEvents.find((e) => e.status === "completed");
  const expressionApplied = expressionEvents.find(
    (e) => e.status === "applied",
  );
  assert.ok(
    actionStart && actionEnd,
    "Player must report actual playback separately",
  );
  assert.ok(
    completed.action < 1000,
    "Action acceptance must not wait for playback",
  );
  assert.ok(actionEnd.receivedAt - started > completed.action + 1000);
  assert.ok(
    expressionApplied &&
      expressionApplied.receivedAt - started > completed.expression + 1000,
    "Expression must be accepted immediately and applied after earlier dialogue",
  );
  assert.ok(
    expressionApplied.receivedAt <= actionStart.receivedAt,
    "Expression and action must follow source event order",
  );
  if (!allowSpeech)
    assert.ok(
      completed.drain > actionEnd.receivedAt - started + 2500,
      "Following dialogue must wait for an exclusive action",
    );
  const invalid = await request("action", "does-not-exist");
  assert.equal(invalid.ok, false);
  assert.ok(existsSync(capturePath));
  assert.ok(readFileSync(capturePath).length > 1000);
  const report = {
    allowSpeech,
    actionEvents,
    expressionEvents,
    capabilities: caps,
    completedMilliseconds: completed,
    invalidAction: invalid.error,
    screenshot: capturePath,
  };
  writeFileSync(join(output, "result.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  cleanup();
}
