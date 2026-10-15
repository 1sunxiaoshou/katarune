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
  process.argv.slice(2).find(arg => !arg.startsWith("--")) ?? "unity/KataruneAvatar/Builds/Windows/KataruneAvatar.exe",
);
const withAudio = process.argv.includes("--audio");
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
  formatVersion: 2,
  id: "builtin:default",
  version: "1.0.0",
  model,
  idle: "",
  idleVariations: [],
  customActions: [],
};
const builtinRoot = join(dirname(executable), "KataruneAvatar_Data/KataruneLocal");
const builtinManifest = JSON.parse(await readFile(join(builtinRoot, "manifest.json"), "utf8"));
const builtinIds = JSON.parse(await readFile(join(builtinRoot, "action-ids.json"), "utf8"));
function resolvePlayback(playback) {
  return Object.fromEntries(Object.entries({ ...playback, layer: playback.layer ?? "body", blending: playback.blending ?? (playback.layer === "head" ? "additive" : "override"), blendSeconds: playback.blendSeconds ?? .2 }).map(([key, value]) => [key, ["file", "enter", "loop", "exit", "reference"].includes(key) ? join(builtinRoot, value) : value]));
}
function phaseEndpoints(raw) {
  const size = raw.readUInt32LE(12), g = JSON.parse(raw.subarray(20, 20 + size).toString());
  return Object.fromEntries(g.animations[0].channels.map(channel => {
    const sampler = g.animations[0].samplers[channel.sampler], accessor = g.accessors[sampler.output];
    const input = g.accessors[sampler.input], timeView = g.bufferViews[input.bufferView];
    const timeOffset = 28 + size + (timeView.byteOffset ?? 0) + (input.byteOffset ?? 0);
    for (let i = 1; i < input.count; i++)
      assert.ok(raw.readFloatLE(timeOffset + i * 4) > raw.readFloatLE(timeOffset + (i - 1) * 4), "Animation key times must strictly increase");
    assert.equal(accessor.componentType, 5126);
    const width = { VEC3: 3, VEC4: 4 }[accessor.type], view = g.bufferViews[accessor.bufferView];
    assert.ok(width && !view.byteStride);
    const offset = 28 + size + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
    const frame = index => Array.from({ length: width }, (_, i) => raw.readFloatLE(offset + (index * width + i) * 4));
    return [g.nodes[channel.target.node].name + ":" + channel.target.path, [frame(0), frame(accessor.count - 1)]];
  }));
}
const builtin = {
  ...base,
  version: builtinManifest.version,
  idle: builtinManifest.systemActions.idle ? join(builtinRoot, builtinManifest.systemActions.idle.file) : "",
  idleVariations: builtinManifest.systemActions.idle_variations.map((a) => join(builtinRoot, a.file)),
  systemBehaviors: Object.entries(builtinManifest.systemActions).filter(([key]) => !["idle", "idle_variations"].includes(key)).map(([name, playback]) => ({ id: "system." + name.toLowerCase(), name, description: "", playback: resolvePlayback(playback) })),
  customActions: builtinManifest.customActions.map((action, index) => ({ ...action, id: builtinIds[index], playback: resolvePlayback(action.playback) })),
};
const bodyFixture = join(output, "body-loop.vrma"), upperFixture = join(output, "upper-gesture.vrma");
await writePackageVrmaFixture(model, bodyFixture, false, [{ bone: "head", axis: [0, 0, 1], amplitude: .15 }, { bone: "leftUpperLeg", axis: [1, 0, 0], amplitude: .3 }, { bone: "rightUpperArm", axis: [0, 0, 1], amplitude: .1 }]);
await writePackageVrmaFixture(model, upperFixture, false, [{ bone: "rightUpperArm", axis: [0, 0, 1], amplitude: .7 }, { bone: "leftUpperLeg", axis: [1, 0, 0], amplitude: 1 }]);
const layered = { ...base, id: randomUUID(), idle: bodyFixture, systemBehaviors: [
  { id: "system.think", name: "think", playback: { kind: "loop", loop: bodyFixture, layer: "body", blending: "override", blendSeconds: .2 } },
  { id: "system.nod", name: "nod", playback: { kind: "oneShot", file: fixture, layer: "head", blending: "additive", blendSeconds: .2 } },
  { id: "system.greet", name: "greet", playback: { kind: "oneShot", file: upperFixture, layer: "upperBody", blending: "override", blendSeconds: .2 } },
  { id: "system.holdarms", name: "holdArms", playback: { kind: "loop", loop: upperFixture, layer: "upperBody", blending: "override", blendSeconds: .2 } },
] };
const pack = {
  ...base,
  id: randomUUID(),
  idle: fixture,
  customActions: [
    {
      id: actionId,
      name: "测试倾头",
      description: "仅验收测试使用",
      file: fixture, key: "测试倾头", playback: { kind: "oneShot", file: fixture },
    },
  ],
};
const numberedId = randomUUID(), heldId = randomUUID();
const phasePack = {
  ...pack, formatVersion: 2, id: randomUUID(),
  customActions: [
    { id: numberedId, key: "001", name: "问候", description: "一次性测试", file: fixture, playback: { kind: "oneShot", file: fixture } },
    { id: heldId, key: "抱臂", name: "抱臂", description: "循环测试", file: fixture, playback: { kind: "loop", loop: fixture } },
  ],
  systemBehaviors: [
    { id: "system.think", name: "think", description: "", playback: { kind: "loop", enter: fixture, loop: fixture, exit: fixture } },
    { id: "system.talk", name: "talk", description: "", playback: { kind: "loop", loop: fixture } },
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
await validate(builtin, "default-idle-and-variations", true);
await validate(pack, "runtime-vrma", true);
await validate({ ...pack, formatVersion: 1 }, "obsolete-package-format", false);
await validate(phasePack, "phased-loop-and-oneshot", true);
await validate(layered, "independent-layers", true);
await validate({ ...layered, systemBehaviors: [{ ...layered.systemBehaviors[0], playback: { kind: "loop", loop: bodyFixture, layer: "body", blending: "additive" } }] }, "body-additive-rejected", false);
await validate({ ...phasePack, systemBehaviors: [{ ...phasePack.systemBehaviors[0], playback: { kind: "loop", loop: fixture, exit: unsupported } }] }, "unsupported-exit", false);
assert.match(await readFile(join(output, "default-empty-actions.log"), "utf8"), /KATARUNE_ADAPTIVE_IDLE_PREBAKED/);
assert.doesNotMatch(await readFile(join(output, "default-idle-and-variations.log"), "utf8"), /KATARUNE_ADAPTIVE_IDLE_(BAKED|CACHE|PREBAKED)/);
assert.doesNotMatch(await readFile(join(output, "runtime-vrma.log"), "utf8"), /KATARUNE_ADAPTIVE_IDLE_(BAKED|CACHE|PREBAKED)/);
// Change only glTF metadata to exercise a new imported model's preparation and
// cache reuse without mutating the distributed model or its skeleton/skin.
const originalModel = await readFile(model);
const jsonLength = originalModel.readUInt32LE(12);
const importedJson = JSON.parse(originalModel.subarray(20, 20 + jsonLength).toString("utf8"));
importedJson.asset.extras = { acceptanceImport: randomUUID() };
const jsonText = Buffer.from(JSON.stringify(importedJson));
const jsonChunk = Buffer.alloc(Math.ceil(jsonText.length / 4) * 4, 0x20);
jsonText.copy(jsonChunk);
const importedBytes = Buffer.concat([originalModel.subarray(0, 20), jsonChunk, originalModel.subarray(20 + jsonLength)]);
importedBytes.writeUInt32LE(importedBytes.length, 8);
importedBytes.writeUInt32LE(jsonChunk.length, 12);
const importedModel = join(output, "imported.vrm");
await writeFile(importedModel, importedBytes);
await validate({ ...base, model: importedModel }, "import-baked", true);
assert.match(await readFile(join(output, "import-baked.log"), "utf8"), /KATARUNE_ADAPTIVE_IDLE_BAKED chains=30 channels=128/);
await validate({ ...base, model: importedModel }, "import-cached", true);
assert.match(await readFile(join(output, "import-cached.log"), "utf8"), /KATARUNE_ADAPTIVE_IDLE_CACHE channels=128/);
await validate(
  { ...pack, customActions: [{ ...pack.customActions[0], playback: { kind: "oneShot", file: unsupported } }] },
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
  if (operation.startsWith("action") || operation === "expression")
    send({
      type: "event",
      runId: "package-acceptance",
      event: {
        type: "tool-input-available",
        toolCallId: id,
        toolName: operation.startsWith("action") ? "avatar_action" : "set_expression",
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
}, 600000);
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
        KATARUNE_CAPTURE_FPS: "20",
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
  await operation("expression", "happy");
  // Keep motion regressions quiet. Audible playback/lipsync is explicitly opt-in.
  if (withAudio) {
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
    const speechId = randomUUID();
    send({ id: speechId, operation: "speech", value: audio });
    await wait(
      (m) => m.type === "speech" && m.id === speechId && m.status === "completed",
    );
  }
  send({ type: "user-subtitle", text: "角色包验收字幕" });
  await delay(300);
  await operation("session-reset", "4");
  const phaseBefore = sequence - 1;
  await operation("load-package", JSON.stringify(phasePack));
  const phaseReady = await wait(m => m.type === "ready", phaseBefore);
  assert.ok(phaseReady.capabilities.actions.some(a => a.semantic === "think" && a.kind === "loop"));
  assert.ok(phaseReady.capabilities.actions.some(a => a.key === "001" && a.kind === "oneShot"));
  const thinking = await operation("action", "system.think");
  const thinkStarted = await wait(m => m.type === "action" && m.id === thinking && m.status === "started");
  assert.ok(thinkStarted.instanceId && thinkStarted.loop);
  await delay(6800); // Enter + more than one main clip duration must keep holding.
  assert.ok(!messages.some(m => m.type === "action" && m.id === thinking && m.status === "completed"));
  await operation("drain", "package-acceptance"); // A held pose cannot block drain or later gestures.
  await operation("load-package", JSON.stringify({ ...phasePack, systemBehaviors: [{ ...phasePack.systemBehaviors[0], playback: { kind: "loop", loop: fixture, exit: unsupported } }] }), false);
  const repeat = await operation("action", "system.think");
  assert.equal((await wait(m => m.type === "action" && m.id === repeat && m.status === "started")).instanceId, thinkStarted.instanceId);
  const temporary = await operation("action", numberedId);
  await wait(m => m.type === "action" && m.id === temporary && m.status === "completed");
  await delay(3300); // The interrupted fixture loop must replay its 3 s enter before holding again.
  const restored = await operation("action", "system.think");
  assert.equal((await wait(m => m.type === "action" && m.id === restored && m.status === "started")).instanceId, thinkStarted.instanceId);
  const finish = await operation("action-finish", "system.think");
  await wait(m => m.type === "action" && m.id === finish && m.status === "completed");
  await wait(m => m.type === "action" && m.id === thinking && m.status === "completed");
  const talking = await operation("action", "system.talk");
  await wait(m => m.type === "action" && m.id === talking && m.status === "started");
  const holding = await operation("action", heldId);
  await wait(m => m.type === "action" && m.id === holding && m.status === "started");
  await wait(m => m.type === "action" && m.id === talking && m.status === "completed");
  const cancelledLoop = await operation("action-cancel", heldId);
  await wait(m => m.type === "action" && m.id === cancelledLoop && m.status === "completed");
  const noExitLoop = await operation("action", "system.talk");
  const noExitStarted = await wait(m => m.type === "action" && m.id === noExitLoop && m.status === "started");
  const noExitFinish = await operation("action-finish", "system.talk");
  const noExitEnded = await wait(m => m.type === "action" && m.id === noExitFinish && m.status === "completed");
  assert.equal(noExitEnded.instanceId, noExitStarted.instanceId);
  const lastShot = await operation("action", numberedId);
  await wait(m => m.type === "action" && m.id === lastShot && m.status === "started");
  const preempt = await operation("action", "system.talk");
  await wait(m => m.type === "action" && m.id === preempt && m.status === "started");
  await wait(m => m.type === "action" && m.id === lastShot && m.status === "cancelled");
  await operation("action-cancel", "system.talk");
  const cancelledShot = await operation("action", numberedId);
  await wait(m => m.type === "action" && m.id === cancelledShot && m.status === "started");
  const shotCancel = await operation("action-cancel", numberedId);
  await wait(m => m.type === "action" && m.id === shotCancel && m.status === "completed");
  await wait(m => m.type === "action" && m.id === cancelledShot && m.status === "cancelled");
  const finalShot = await operation("action", numberedId);
  await wait(m => m.type === "action" && m.id === finalShot && m.status === "completed");
  console.log("[package-player] loops: hold, idempotence, drain, gesture restore, optional exit, switch, cancel and failed-load retention passed");
  await operation("load-package", JSON.stringify(layered));
  const layeredBody = await operation("action", "system.think");
  const layeredBodyStarted = await wait(m => m.type === "action" && m.id === layeredBody && m.status === "started");
  await delay(3300); // A full baseline cycle for comparing the lower-body mask.
  const upperLoop = await operation("action", "system.holdarms");
  const upperLoopStarted = await wait(m => m.type === "action" && m.id === upperLoop && m.status === "started");
  const upperShot = await operation("action", "system.greet");
  const headShot = await operation("action", "system.nod");
  await wait(m => m.type === "action" && m.id === upperShot && m.status === "started");
  await wait(m => m.type === "action" && m.id === headShot && m.status === "started");
  await operation("drain", "package-acceptance");
  await wait(m => m.type === "action" && m.id === upperShot && m.status === "completed");
  await wait(m => m.type === "action" && m.id === headShot && m.status === "completed");
  const resumedUpper = await operation("action", "system.holdarms");
  assert.equal((await wait(m => m.type === "action" && m.id === resumedUpper && m.status === "started")).instanceId, upperLoopStarted.instanceId);
  const continuousBody = await operation("action", "system.think");
  assert.equal((await wait(m => m.type === "action" && m.id === continuousBody && m.status === "started")).instanceId, layeredBodyStarted.instanceId);
  await operation("action-cancel", "system.holdarms");
  await delay(300);
  const headOnly = await operation("action", "system.nod");
  const headOnlyStarted = await wait(m => m.type === "action" && m.id === headOnly && m.status === "started");
  await wait(m => m.type === "action" && m.id === headOnly && m.status === "completed");
  const cancelHead = await operation("action", "system.nod");
  await wait(m => m.type === "action" && m.id === cancelHead && m.status === "started");
  await operation("action-cancel", "system.nod");
  await wait(m => m.type === "action" && m.id === cancelHead && m.status === "cancelled");
  await delay(300);
  await operation("action-cancel", "system.think");
  console.log("[package-player] independent head and upper body, same-instance restore and targeted cancel passed");
  const finalBefore = sequence - 1;
  await operation("load-package", JSON.stringify(base));
  assert.deepEqual(
    (await wait((m) => m.type === "ready", finalBefore)).capabilities.actions,
    [],
  );
  await operation("action", nextActionId, false);
  const builtinBefore = sequence - 1;
  await operation("load-package", JSON.stringify(builtin));
  const builtinReady = await wait(m => m.type === "ready", builtinBefore);
  assert.equal(builtinReady.capabilities.actions.length, 29);
  assert.ok(!builtinReady.capabilities.actions.some(a => a.id.startsWith("idle.")));
  assert.equal(builtinReady.capabilities.actions.find(a => a.semantic === "nod").layer, "head");
  // Exercise the same desktop commands used by the manual picker, not only AI actions.
  await operation("desktop-action", "system.think");
  await delay(2400);
  await operation("desktop-action", "system.nod");
  await delay(1800);
  const encourage = builtin.systemBehaviors.find(a => a.id === "system.encourage").playback;
  const encourageBytes = await readFile(encourage.file);
  const encourageGltf = JSON.parse(encourageBytes.subarray(20, 20 + encourageBytes.readUInt32LE(12)).toString());
  const encourageDuration = encourageGltf.accessors[encourageGltf.animations[0].samplers[0].input].max[0];
  await operation("desktop-action", "system.encourage");
  await delay((encourageDuration + 2.2) * 1000); // Full-body one-shot, then Think enter and loop.
  await operation("desktop-action", "system.talk");
  await delay(3300); // Think exit (1.47 s), Chat enter (1.33 s), then the loop.
  await operation("desktop-action", "none");
  await delay(1600);
  const actualThink = await operation("action", "system.think");
  const actualThinkStarted = await wait(m => m.type === "action" && m.id === actualThink && m.status === "started");
  await delay(2000);
  const actualGreet = await operation("action", "system.greet"), actualNod = await operation("action", "system.nod");
  await wait(m => m.type === "action" && m.id === actualNod && m.status === "completed");
  await wait(m => m.type === "action" && m.id === actualGreet && m.status === "completed");
  const actualEncourage = await operation("action", "system.encourage");
  await wait(m => m.type === "action" && m.id === actualEncourage && m.status === "completed");
  await delay(2200); // The same controller must reenter for a program-driven interruption too.
  const actualThinkRepeat = await operation("action", "system.think");
  assert.equal((await wait(m => m.type === "action" && m.id === actualThinkRepeat && m.status === "started")).instanceId, actualThinkStarted.instanceId);
  await operation("action-finish", "system.think");
  await wait(m => m.type === "action" && m.id === actualThink && m.status === "completed");
  const observedLoops = [];
  for (const action of builtinReady.capabilities.actions) {
    const request = await operation("action", action.id);
    const started = await wait(m => m.type === "action" && m.id === request && m.status === "started");
    if (action.kind === "loop") {
      const playback = [...builtin.systemBehaviors, ...builtin.customActions].find(a => a.id === action.id).playback;
      // Authored phase boundaries must already meet; observe three complete wraps.
      const raw = await readFile(playback.enter);
      const gltf = JSON.parse(raw.subarray(20, 20 + raw.readUInt32LE(12)).toString());
      const duration = gltf.accessors[gltf.animations[0].samplers[0].input].max[0];
      const loopRaw = await readFile(playback.loop);
      const loopGltf = JSON.parse(loopRaw.subarray(20, 20 + loopRaw.readUInt32LE(12)).toString());
      const loopDuration = loopGltf.accessors[loopGltf.animations[0].samplers[0].input].max[0];
      const enterEnds = phaseEndpoints(raw), loopEnds = phaseEndpoints(loopRaw);
      for (const [bone, [first, last]] of Object.entries(loopEnds)) {
        assert.deepEqual(enterEnds[bone]?.[1], first, `${action.id}: enter must meet loop on ${bone}`);
        assert.deepEqual(first, last, `${action.id}: loop must close on ${bone}`);
      }
      observedLoops.push({ id: action.id, instanceId: started.instanceId, layer: action.layer, duration: loopDuration });
      await delay((duration + loopDuration * 3 + .25) * 1000);
      const finish = await operation("action-finish", action.id);
      await wait(m => m.type === "action" && m.id === finish && m.status === "completed");
    }
    await wait(m => m.type === "action" && m.id === request && m.status === "completed");
  }
  console.log("[package-player] all 29 actions played; every loop observed for at least three wraps");
  await delay(2400); // Capture a complete cycle of the real builtin humanoid idle.
  await new Promise((done) => {
    child.once("exit", done);
    child.kill();
  });
  const frames = (await readFile(join(output, "frames.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .map(JSON.parse);
  const loopCoverage = observedLoops.map(action => {
    const lane = frame => frame.performance.match(new RegExp(`${action.layer}\\[([^\\]]*)\\]`))?.[1] ?? "";
    const own = frames.map(lane).filter(value => value.includes(`instance=${action.instanceId};`));
    const loop = own.filter(value => value.includes("phase=Loop;")).map(value => Number(value.match(/time=([\d.]+)/)[1]));
    const wraps = loop.filter((time, i) => i > 0 && loop[i - 1] - time > action.duration / 2).length;
    assert.ok(wraps >= 3, `${action.id} must render at least three full loop wraps, saw ${wraps}`);
    return { id: action.id, wraps, frames: loop.length, firstLoopTime: loop[0], phaseBoundaryClosed: true };
  });
  assert.ok(frames.some((f) => f.actionId === actionId));
  assert.ok(frames.some((f) => f.actionId === nextActionId));
  const parallelFrames = frames.filter(f => /body\[action=system.think;/.test(f.performance) && /upperBody\[action=system.greet;/.test(f.performance) && /head\[action=system.nod;/.test(f.performance));
  assert.ok(parallelFrames.length > 3, "All three layers must run in the same rendered frames");
  const angleBetween = (a, b) => 2 * Math.acos(Math.min(1, Math.abs(a.x*b.x + a.y*b.y + a.z*b.z + a.w*b.w))) * 180 / Math.PI;
  const manualInstances = frames.filter(f => /body\[action=system.think;.*next=system.talk/.test(f.performance));
  assert.ok(manualInstances.some(f => f.performance.includes("phase=Exit")), "Manual switching must render the old exit before the queued pose starts");
  const manualThinkInstance = manualInstances[0]?.performance.match(/body\[.*?instance=([^;]+)/)?.[1];
  const bodyInstance = f => f.performance.match(/^body\[.*?instance=([^;]*)/)?.[1];
  const manualThinkFrames = frames.filter(f => bodyInstance(f) === manualThinkInstance);
  const phaseOrder = motionFrames => motionFrames.map(f => f.performance.match(/^body\[.*?phase=(\w+)/)?.[1]).filter((phase, index, phases) => phase !== phases[index - 1]);
  assert.deepEqual(phaseOrder(manualThinkFrames), ["Enter", "Loop", "Enter", "Loop", "Exit"], "Manual full-body interruption must reenter; independent nod must not");
  const programThinkFrames = frames.filter(f => bodyInstance(f) === actualThinkStarted.instanceId);
  assert.deepEqual(phaseOrder(programThinkFrames), ["Enter", "Loop", "Enter", "Loop", "Exit"], "Program requests must use the same reentry rule as the manual picker");
  assert.ok(manualThinkFrames.some(f => /head\[action=system.nod;/.test(f.performance)), "Manual head selection must preserve the held body instance");
  const manualTalkInstance = frames.find(f => /body\[action=system.talk;/.test(f.performance) && f.time > manualThinkFrames[0].time)?.performance.match(/body\[.*?instance=([^;]+)/)?.[1];
  assert.ok(manualTalkInstance);
  const manualTalkFrames = frames.filter(f => bodyInstance(f) === manualTalkInstance);
  assert.deepEqual(phaseOrder(manualTalkFrames), ["Enter", "Loop", "Exit"], "Manual none must play the active pose's exit");
  const firstParallel = parallelFrames[0];
  assert.ok(Math.max(...parallelFrames.map(f => angleBetween(f.legRotation, firstParallel.legRotation))) > 1, "Body legs must continue moving beneath both gestures");
  assert.ok(Math.max(...parallelFrames.map(f => angleBetween(f.armRotation, firstParallel.armRotation))) > 3, "Upper layer must actually move the arm");
  assert.ok(Math.max(...parallelFrames.map(f => angleBetween(f.headRotation, firstParallel.headRotation))) > 1, "Head layer must actually move the head");
  const fixtureBodyFrames = frames.filter(f => f.performance.includes(layeredBodyStarted.instanceId));
  const bodyTime = f => Number(f.performance.match(/^body\[.*?time=([\d.]+)/)?.[1]);
  const firstUpperTime = fixtureBodyFrames.find(f => f.performance.includes("upperBody[action=system.holdarms;")).time;
  // An inactive lane can still be fading out. Use the settled body-only cycle
  // recorded before either overlay, not frames during their return blend.
  const lowerBaseline = fixtureBodyFrames.filter(f => f.time >= fixtureBodyFrames[0].time + .25 && f.time < firstUpperTime
    && f.performance.includes("upperBody[action=idle;") && f.performance.includes("head[action=idle;"));
  const maskedFrames = fixtureBodyFrames.filter(f => f.performance.includes("upperBody[action=system.greet;"));
  assert.ok(lowerBaseline.length > 10 && maskedFrames.length > 10);
  const maskErrors = maskedFrames.map(f => {
    const closest = lowerBaseline.reduce((a, b) => Math.abs(bodyTime(a)-bodyTime(f)) < Math.abs(bodyTime(b)-bodyTime(f)) ? a : b);
    return angleBetween(f.legRotation, closest.legRotation);
  });
  assert.ok(Math.max(...maskErrors) < 2, "Upper gesture's deliberately large leg curve must be masked out while the body's own leg curve continues");
  const headOnlyFrames = fixtureBodyFrames.filter(f => f.performance.includes(headOnlyStarted.instanceId));
  const headErrors = headOnlyFrames.filter(f => {
    const time = Number(f.performance.match(/head\[.*?time=([\d.]+)/)?.[1]); return time > .25 && time < 2.8;
  }).map(f => {
    const closest = lowerBaseline.reduce((a,b) => Math.abs(bodyTime(a)-bodyTime(f)) < Math.abs(bodyTime(b)-bodyTime(f)) ? a : b);
    const time = Number(f.performance.match(/head\[.*?time=([\d.]+)/)?.[1]);
    const wave = time < .75 ? time/.75 : time < 1.5 ? (1.5-time)/.75 : time < 2.25 ? (time-1.5)/.75 : (3-time)/.75;
    return Math.abs(angleBetween(f.headRotation, closest.headRotation) - .4 * wave * 180/Math.PI);
  });
  assert.ok(headErrors.length > 10 && Math.max(...headErrors) < 2, "Head delta must add to the moving body head, rather than replacing its absolute pose");
  const rotations = frames.map((f) => f.headRotation.z);
  assert.ok(
    Math.max(...rotations) - Math.min(...rotations) > 0.05,
    "VRMA must actually move the head bone",
  );
  assert.ok(frames.some((f) => f.subtitle.includes("角色包验收字幕")));
  const idleEnd = frames.at(-1).time;
  const builtinIdleFrames = frames.filter((f) => f.time >= idleEnd - 2);
  assert.ok(builtinIdleFrames.length > 10, "The builtin idle must keep updating over a full cycle");
  const firstIdleRotation = builtinIdleFrames[0].headRotation;
  const idleMotionDegrees = Math.max(...builtinIdleFrames.map((f) => {
    const q = f.headRotation;
    const dot = Math.min(1, Math.abs(q.x * firstIdleRotation.x + q.y * firstIdleRotation.y + q.z * firstIdleRotation.z + q.w * firstIdleRotation.w));
    return 2 * Math.acos(dot) * 180 / Math.PI;
  }));
  assert.ok(idleMotionDegrees > 0.1, "The real builtin idle must move the retargeted head, not hold a fixed pose");
  if (withAudio) assert.ok(
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
      builtinIdleAndVariations: true,
      builtinIdleMotionDegrees: idleMotionDegrees,
      phasedLoopsAndOneShots: true,
      manualLoopSwitchAndExit: true,
      interruptedPoseReentersForManualAndProgram: true,
      independentLayers: true,
      actualDefaultActions: 29,
      loopCoverage,
      maximumLowerMaskErrorDegrees: Math.max(...maskErrors),
      maximumHeadAdditiveErrorDegrees: Math.max(...headErrors),
      customActions: true,
      cancellation: true,
      failedLoadPreserved: true,
      crossPackageIds: true,
      speechLipsync: withAudio ? true : null,
      subtitles: true,
    }),
  );
  console.log(
    `[package-player] actual playback, retargeting, cancellation, switch, failure retention${withAudio ? ", speech" : ""} and subtitle passed: ${output}`,
  );
} finally {
  clearTimeout(lifetime);
  socket?.destroy();
  server.close();
  child?.kill();
}
