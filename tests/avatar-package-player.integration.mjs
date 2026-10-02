import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve, join } from "node:path";
import { writePackageVrmaFixture } from "./packageVrmaFixture.mjs";

const output = resolve(".test-dist/avatar-packages", String(Date.now()));
await mkdir(output, { recursive: true });
const executable = resolve(
  process.argv[2] ?? "unity/KataruneAvatar/Builds/Windows/KataruneAvatar.exe",
);
const model = join(
  dirname(executable),
  "KataruneAvatar_Data/KataruneLocal/Models/default-avatar.vrm",
);
const fixture = join(output, "fixture.vrma"),
  unsupported = join(output, "unsupported.vrma");
await writePackageVrmaFixture(model, fixture);
await writePackageVrmaFixture(model, unsupported, true);
const actionId = randomUUID(),
  nextActionId = randomUUID();
const base = {
  id: "builtin:default",
  version: "1.0.0",
  model,
  idle: "",
  idleVariations: [],
  customActions: [],
};
const pack = {
  ...base,
  id: randomUUID(),
  idle: fixture,
  customActions: [
    {
      id: actionId,
      name: "测试倾头",
      description: "仅验收测试使用",
      file: fixture,
    },
  ],
};
const env = {
  ...process.env,
  KATARUNE_AVATAR_PIPE: "",
  KATARUNE_CHARACTER_PACKAGE: "",
};
async function validate(candidate, name, valid) {
  const input = join(output, `${name}.json`),
    result = join(output, `${name}-result.json`);
  await writeFile(input, JSON.stringify(candidate));
  await new Promise((done, fail) => {
    const player = spawn(
      executable,
      [
        "-batchmode",
        "-nographics",
        "--validate-package",
        input,
        "--validation-result",
        result,
        "-logFile",
        join(output, `${name}.log`),
      ],
      { env, stdio: "ignore", windowsHide: true },
    );
    const timer = setTimeout(() => {
      player.kill();
      fail(new Error("Validation timeout"));
    }, 45000);
    player.once("error", fail);
    player.once("exit", () => {
      clearTimeout(timer);
      done();
    });
  });
  const report = JSON.parse(await readFile(result, "utf8"));
  assert.equal(report.ok, valid, report.error);
  console.log(`[package-player] ${name}: ${valid ? "accepted" : "rejected"}`);
}
await validate(base, "default-empty-actions", true);
await validate(pack, "runtime-vrma", true);
await validate(
  { ...pack, customActions: [{ ...pack.customActions[0], file: unsupported }] },
  "unsupported-tracks",
  false,
);
await validate({ ...base, model: fixture }, "invalid-model", false);

let socket,
  child,
  sequence = 0;
const messages = [];
const pipe = `katarune-package-test-${randomUUID()}`,
  server = createServer((connection) => {
    socket = connection;
    connection.setEncoding("utf8");
    let buffer = "";
    connection.on("data", (data) => {
      buffer += data;
      let end;
      while ((end = buffer.indexOf("\n")) >= 0) {
        messages.push({
          ...JSON.parse(buffer.slice(0, end)),
          sequence: sequence++,
        });
        buffer = buffer.slice(end + 1);
      }
    });
  });
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
async function wait(predicate, after = -1) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const value = messages.find((m) => m.sequence > after && predicate(m));
    if (value) return value;
    await delay(20);
  }
  throw new Error(
    "Player reply timed out: " + JSON.stringify(messages.slice(-5)),
  );
}
function send(value) {
  socket.write(JSON.stringify(value) + "\n");
}
async function operation(operation, value, ok = true) {
  const id = randomUUID();
  if (operation === "action" || operation === "expression")
    send({
      type: "event",
      runId: "package-acceptance",
      event: {
        type: "tool-input-available",
        toolCallId: id,
        toolName: operation === "action" ? "avatar_action" : "set_expression",
        input: {},
      },
    });
  send({ id, operation, value, allowSpeech: true, toolCallId: id });
  const result = await wait((m) => m.type === "result" && m.id === id);
  assert.equal(result.ok, ok, result.error);
  return id;
}
const lifetime = setTimeout(() => {
  child?.kill();
  console.error("Player timed out");
  process.exit(1);
}, 80000);
try {
  await new Promise((done) => server.listen(`\\\\.\\pipe\\${pipe}`, done));
  const input = join(output, "startup.json");
  await writeFile(input, JSON.stringify(pack));
  child = spawn(
    executable,
    [
      "--opaque-window",
      "-screen-fullscreen",
      "0",
      "-screen-width",
      "800",
      "-screen-height",
      "720",
      "-logFile",
      join(output, "player.log"),
    ],
    {
      cwd: dirname(executable),
      windowsHide: !process.argv.includes("--visible"),
      stdio: "ignore",
      env: {
        ...env,
        KATARUNE_CHARACTER_PACKAGE: input,
        KATARUNE_AVATAR_PIPE: pipe,
        KATARUNE_SPEECH_CAPTURE: output,
      },
    },
  );
  const ready = await wait((m) => m.type === "ready");
  assert.deepEqual(
    ready.capabilities.actions.map((a) => a.id),
    [actionId],
  );
  send({ type: "binding", epoch: 1 });
  await delay(1600);
  await operation("validate-package", JSON.stringify(pack));
  await operation(
    "validate-package",
    JSON.stringify({ ...pack, model: fixture }),
    false,
  );
  const action = await operation("action", actionId);
  await wait(
    (m) => m.type === "action" && m.id === action && m.status === "completed",
  );
  const canceled = await operation("action", actionId);
  await wait(
    (m) => m.type === "action" && m.id === canceled && m.status === "started",
  );
  await operation("desktop-action", "none");
  await wait(
    (m) => m.type === "action" && m.id === canceled && m.status === "cancelled",
  );
  await operation("session-reset", "2");
  await operation(
    "load-package",
    JSON.stringify({ ...pack, model: fixture }),
    false,
  );
  await operation("action", actionId); // Failed model load retained the old action catalog and model.
  await operation("session-reset", "3");
  const before = sequence - 1,
    nextPack = {
      ...pack,
      id: randomUUID(),
      customActions: [{ ...pack.customActions[0], id: nextActionId }],
    };
  await operation("load-package", JSON.stringify(nextPack));
  const next = await wait((m) => m.type === "ready", before);
  assert.deepEqual(
    next.capabilities.actions.map((a) => a.id),
    [nextActionId],
  );
  await operation("action", actionId, false);
  const newAction = await operation("action", nextActionId);
  await wait(
    (m) => m.type === "action" && m.id === newAction && m.status === "started",
  );
  const wav = Buffer.alloc(44 + 24000 * 2);
  wav.write("RIFF");
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(24000, 24);
  wav.writeUInt32LE(48000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(wav.length - 44, 40);
  for (let i = 0; i < 24000; i++)
    wav.writeInt16LE(
      Math.round(Math.sin((i * Math.PI * 2 * 220) / 24000) * 8000),
      44 + i * 2,
    );
  const audio = join(output, "speech.wav");
  await writeFile(audio, wav);
  await operation("expression", "happy");
  const speechId = randomUUID();
  send({ id: speechId, operation: "speech", value: audio });
  await wait(
    (m) => m.type === "speech" && m.id === speechId && m.status === "completed",
  );
  send({ type: "user-subtitle", text: "角色包验收字幕" });
  await delay(300);
  await operation("session-reset", "4");
  const finalBefore = sequence - 1;
  await operation("load-package", JSON.stringify(base));
  assert.deepEqual(
    (await wait((m) => m.type === "ready", finalBefore)).capabilities.actions,
    [],
  );
  await operation("action", nextActionId, false);
  await delay(250);
  await new Promise((done) => {
    child.once("exit", done);
    child.kill();
  });
  const frames = (await readFile(join(output, "frames.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .map(JSON.parse);
  assert.ok(frames.some((f) => f.actionId === actionId));
  assert.ok(frames.some((f) => f.actionId === nextActionId));
  const rotations = frames.map((f) => f.headRotation.z);
  assert.ok(
    Math.max(...rotations) - Math.min(...rotations) > 0.05,
    "VRMA must actually move the head bone",
  );
  assert.ok(frames.some((f) => f.subtitle.includes("角色包验收字幕")));
  assert.ok(
    frames.some((f) => Math.max(f.aa, f.ih, f.ou, f.ee, f.oh) > 0.02),
    "Speech still drives lipsync",
  );
  await writeFile(
    join(output, "messages.json"),
    JSON.stringify(messages, null, 2),
  );
  await writeFile(
    join(output, "acceptance.json"),
    JSON.stringify({
      passed: true,
      output,
      idle: true,
      customActions: true,
      cancellation: true,
      failedLoadPreserved: true,
      crossPackageIds: true,
      speechLipsync: true,
      subtitles: true,
    }),
  );
  console.log(
    `[package-player] actual playback, retargeting, cancellation, switch, failure retention, speech and subtitle passed: ${output}`,
  );
} finally {
  clearTimeout(lifetime);
  socket?.destroy();
  server.close();
  child?.kill();
}
