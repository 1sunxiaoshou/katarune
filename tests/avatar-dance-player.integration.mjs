import { cameraGlb } from "./cameraGlbFixture.mjs";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdir, readFile, writeFile, unlink, readdir, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { writePackageVrmaFixture } from "./packageVrmaFixture.mjs";

const output = resolve(".test-dist/dance-player", String(Date.now()));
await mkdir(output, { recursive: true });
const executable = resolve(process.argv[2] ?? "unity/KataruneAvatar/Builds/Windows/KataruneAvatar.exe");
const model = join(dirname(executable), "KataruneAvatar_Data/KataruneLocal/Models/default-avatar.vrm");
const motion = join(output, "three-second.vrma");
await writePackageVrmaFixture(model, motion, false, [{ bone: "rightUpperArm", axis: [0, 0, 1], amplitude: .5 }]);
function silentWav(seconds) {
  const frames = Math.round(seconds * 16000), data = Buffer.alloc(44 + frames * 2);
  data.write("RIFF"); data.writeUInt32LE(data.length - 8, 4); data.write("WAVEfmt ", 8);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
  data.writeUInt32LE(16000, 24); data.writeUInt32LE(32000, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34);
  data.write("data", 36); data.writeUInt32LE(frames * 2, 40); return data;
}
const audio = join(output, "music.wav"), vanishedAudio = join(output, "vanishing.wav"), nearEndAudio = join(output, "near-end.wav");
await writeFile(audio, silentWav(3)); await writeFile(vanishedAudio, silentWav(3)); await writeFile(nearEndAudio, silentWav(2.951));
const subtitles = join(output, "lyrics.srt");
const cameraTrack = join(output, "camera.glb");
await writeFile(cameraTrack, cameraGlb());
await writeFile(subtitles, "1\n00:00:00,000 --> 00:00:00,650\n第一句歌词\n\n2\n00:00:01,150 --> 00:00:02,300\n第二句歌词\n");
const silentId = randomUUID(), mediaId = randomUUID(), ordinaryId = randomUUID(), missingId = randomUUID(), nearEndId = randomUUID();
const trackId = randomUUID(), headId = randomUUID();
const pack = {
  formatVersion: 3, id: randomUUID(), version: "1.0.0", model, idle: { variations: [] }, bindings: [],
  actions: [
    { id: headId, key: "head", name: "头部单次动作", description: "独立通道验收", playback: { kind: "oneShot", motion, layer: "head" } },
    { id: ordinaryId, key: "normal", name: "普通手势", description: "隔离验收素材", playback: { kind: "oneShot", motion: motion } },
    { id: silentId, key: "silent", name: "无媒体舞蹈", description: "隔离验收素材", playback: { kind: "performance", motion: motion } },
    { id: mediaId, key: "media", name: "带伴奏、歌词与镜头", description: "隔离验收素材", playback: { kind: "performance", motion: motion, audio, subtitles, camera: { kind: "presets", keys: [{ at: 0, view: "center" }, { at: 1, view: "closeup" }] } } },
    { id: missingId, key: "missing", name: "加载失败验收", description: "隔离验收素材", playback: { kind: "performance", motion: motion, audio: vanishedAudio } },
    { id: nearEndId, key: "near-end", name: "伴奏尾部容差", description: "隔离验收素材", playback: { kind: "performance", motion: motion, audio: nearEndAudio } },
    { id: trackId, key: "track", name: "连续镜头轨道", description: "隔离验收素材", playback: { kind: "performance", motion: motion, audio, camera: { kind: "track", file: cameraTrack, referenceHeight: 1.6, shots: [{ at: 0, node: "MainCamera" }, { at: 2, node: "OrthoCamera" }] } } },
  ],
};
const packageFile = join(output, "package.json"); await writeFile(packageFile, JSON.stringify(pack));
const messages = []; let connection, child, sequence = 0;
const pipe = `katarune-dance-${randomUUID()}`;
const server = createServer(socket => {
  connection = socket; socket.setEncoding("utf8"); let buffer = "";
  socket.on("data", chunk => { buffer += chunk; let end;
    while ((end = buffer.indexOf("\n")) >= 0) {
      messages.push({ ...JSON.parse(buffer.slice(0, end)), sequence: sequence++ }); buffer = buffer.slice(end + 1);
    }
  });
});
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function wait(predicate, after = -1, timeout = 25000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const found = messages.find(message => message.sequence > after && predicate(message)); if (found) return found; await delay(20); }
  throw new Error("Dance Player reply timed out: " + JSON.stringify(messages.slice(-4)));
}
const send = message => connection.write(JSON.stringify(message) + "\n");
async function operation(operation, value = "", ok = true) {
  const id = randomUUID(); send({ id, operation, value });
  const reply = await wait(message => message.type === "result" && message.id === id);
  assert.equal(reply.ok, ok, reply.error); return reply;
}
async function completed(reply, actionId) {
  const result = await wait(message => message.type === "dance" && message.id === reply.id);
  assert.equal(result.status, "completed", result.error); assert.equal(result.actionId, actionId);
  assert.ok(result.sequence > reply.sequence, "The true-start reply must precede terminal feedback"); return result;
}
const lifetime = setTimeout(() => { child?.kill(); console.error("Dance Player timeout"); process.exit(1); }, 120000);
try {
  await new Promise(resolve => server.listen(`\\\\.\\pipe\\${pipe}`, resolve));
  child = spawn(executable, ["--opaque-window", "-screen-fullscreen", "0", "-screen-width", "800", "-screen-height", "720", "-logFile", join(output, "player.log")], {
    cwd: dirname(executable), windowsHide: true, stdio: "ignore",
    env: { ...process.env, KATARUNE_CHARACTER_PACKAGE: packageFile, KATARUNE_AVATAR_PIPE: pipe, KATARUNE_SPEECH_CAPTURE: output, KATARUNE_CAPTURE_FPS: "20" },
  });
  const ready = await wait(message => message.type === "ready");
  assert.equal(ready.capabilities.actions.filter(action => action.kind === "performance").length, 5);
  send({ type: "binding", epoch: 1 });
  const silent = await operation("dance", silentId);
  assert.ok(!messages.some(message => message.type === "dance" && message.id === silent.id), "Starting must return while the dance is still playing");
  await operation("action", ordinaryId, false);
  await operation("dance", mediaId, false);
  await operation("drain", "synthetic-dialogue");
  await operation("run-cancel", "synthetic-dialogue");
  await delay(250);
  assert.ok(!messages.some(message => message.type === "dance" && message.id === silent.id), "Dialogue completion/cancellation must not end an independent dance");
  await completed(silent, silentId);
  console.log("[dance-player] no-media playback, busy rejection and dialogue-independent lifetime passed");

  const manualMedia = await operation("desktop-action", mediaId);
  await delay(400);
  await operation("desktop-action", "unavailable-action", false);
  assert.ok(!messages.some(message => message.type === "dance" && message.id === manualMedia.id), "An invalid selection must leave the current dance playing");
  const manualTrack = await operation("desktop-action", trackId);
  const replacedMedia = await wait(message => message.type === "dance" && message.id === manualMedia.id);
  assert.equal(replacedMedia.status, "failed");
  assert.match(replacedMedia.error, /切换/);
  assert.ok(replacedMedia.sequence < manualTrack.sequence, "The previous dance must terminate before its replacement starts");
  await delay(400);
  const manualGesture = await operation("desktop-action", ordinaryId);
  assert.equal((await wait(message => message.type === "dance" && message.id === manualTrack.id)).status, "failed");
  await wait(message => message.type === "presentation" && message.action === ordinaryId && message.playingActions?.includes(ordinaryId) && !message.playingActions.some(id => [mediaId, trackId].includes(id)), manualGesture.sequence - 1);
  await delay(350);
  await operation("desktop-action", "none");
  const manualStop = await operation("desktop-action", mediaId);
  await operation("desktop-action-stop", mediaId);
  assert.equal((await wait(message => message.type === "dance" && message.id === manualStop.id)).status, "failed");
  console.log("[dance-player] manual dance-to-dance, dance-to-gesture, stop and invalid-selection retention passed");

  const headOnly = await operation("desktop-action", headId);
  await wait(message => message.type === "presentation" && message.playingActions?.includes(headId), headOnly.sequence - 1);
  const bodyAndHead = await operation("desktop-action", ordinaryId);
  await wait(message => message.type === "presentation" && message.playingActions?.includes(headId) && message.playingActions.includes(ordinaryId), bodyAndHead.sequence - 1);
  const stopHead = await operation("desktop-action-stop", headId);
  await wait(message => message.type === "presentation" && message.playingActions?.includes(ordinaryId) && !message.playingActions.includes(headId), stopHead.sequence - 1);
  const stopBody = await operation("desktop-action-stop", ordinaryId);
  await wait(message => message.type === "presentation" && message.playingActions?.length === 0, stopBody.sequence - 1);
  await operation("desktop-action-stop", ordinaryId); // Repeated stop cannot cancel an unrelated/new action.
  console.log("[dance-player] head-only and parallel-channel playback selection states passed");

  const withMedia = await operation("dance", mediaId);
  await completed(withMedia, mediaId);
  console.log("[dance-player] configured WAV and timed preset camera completed");
  const continuous = await operation("dance", trackId);
  await completed(continuous, trackId);
  const invalidTrack = { ...pack, id: randomUUID(), actions: [{ ...pack.actions.at(-1), playback: { kind: "performance", motion: motion, camera: { kind: "track", file: join(output, "absent-camera.glb") } } }] };
  await operation("validate-package", JSON.stringify(invalidTrack), false);
  console.log("[dance-player] audio-clock camera track completed; missing track rejects before package publication");
  const nearEnd = await operation("dance", nearEndId);
  await completed(nearEnd, nearEndId);
  console.log("[dance-player] permitted accompaniment tail tolerance completed");

  await unlink(vanishedAudio);
  const missing = await operation("dance", missingId, false);
  assert.match(missing.error, /伴奏.*不可用/);
  assert.ok(!missing.error.includes(output), "Player errors must not expose managed file paths");
  const invalid = { ...pack, id: randomUUID(), actions: [{ ...pack.actions[2], playback: { kind: "performance", motion: motion, audio: join(output, "absent.wav") } }] };
  await operation("validate-package", JSON.stringify(invalid), false);
  const restored = await operation("dance", silentId);
  await completed(restored, silentId);
  console.log("[dance-player] missing configured media rejects; prior package remains usable");

  const interrupted = await operation("dance", mediaId);
  await operation("session-reset");
  const stopped = await wait(message => message.type === "dance" && message.id === interrupted.id);
  assert.equal(stopped.status, "failed", "Reset must report interruption instead of successful completion");
  const interruptedTrack = await operation("dance", trackId);
  await delay(1100); await operation("session-reset");
  assert.equal((await wait(message => message.type === "dance" && message.id === interruptedTrack.id)).status, "failed");
  await operation("dance", ordinaryId, false);
  await delay(250);
  const frames = (await readFile(join(output, "frames.jsonl"), "utf8")).trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
  const moving = frames.filter(frame => frame.dancing && frame.actionId === mediaId && frame.dancePosition > .3 && frame.dancePosition < 2.8);
  assert.ok(moving.length > 8, "Capture must observe actual media-clock samples");
  assert.ok(moving.some(frame => frame.cameraView === "center") && moving.some(frame => frame.cameraView === "closeup"), "Configured camera cues must both execute");
  for (let index = 1; index < moving.length; index++) {
    const previous = moving[index - 1], current = moving[index];
    if (current.dancePosition < previous.dancePosition) continue; // A later playback restarts its clock.
    assert.ok(Math.abs((current.time - previous.time) - (current.dancePosition - previous.dancePosition)) < .15, "Motion must follow elapsed audio playback time");
  }
  const rotations = moving.map(frame => frame.armRotation);
  assert.ok(moving.some(frame => frame.subtitle === "第一句歌词") && moving.some(frame => frame.subtitle === "第二句歌词"), "Lyrics must follow the same real media clock");
  const gaps = moving.filter(frame => frame.dancePosition > .75 && frame.dancePosition < 1.05);
  assert.ok(gaps.length > 0 && gaps.every(frame => frame.subtitle === ""), "Music subtitle gaps must remain empty");
  const lyricFrames = moving.filter(frame => frame.subtitleKind === "music" && frame.subtitle);
  assert.ok(lyricFrames.length > 0 && lyricFrames.every(frame => Math.abs(frame.subtitleColor.r - 1) < .005
    && Math.abs(frame.subtitleColor.g - 143 / 255) < .005 && Math.abs(frame.subtitleColor.b - 179 / 255) < .005), "Only music lyrics use the specified pink");
  const angle = (a, b) => 2 * Math.acos(Math.min(1, Math.abs(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w)));
  assert.ok(rotations.some(rotation => angle(rotation, rotations[0]) > .1), "The dance must actually animate the avatar");
  const baseline = frames.find(frame => frame.dancing && frame.actionId === silentId)?.cameraPosition;
  const final = frames.at(-1);
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  const tracked = frames.filter(frame => frame.dancing && frame.actionId === trackId && frame.dancePosition > .05 && frame.dancePosition < 2.9);
  assert.ok(tracked.length > 15 && tracked.every(frame => frame.cameraView === "track"));
  const expectedX = seconds => seconds < 1 ? seconds : seconds < 2 ? 1 - (seconds - 1) * 2 : -1;
  const scale = tracked[0].cameraPosition.z / 3;
  assert.ok(tracked.every(frame => Math.abs(frame.cameraPosition.x - expectedX(frame.dancePosition) * scale) < .035), "GLB camera interpolation and shot cuts must use the actual audio cursor");
  assert.ok(tracked.filter(frame => frame.dancePosition < 2).every(frame => Math.abs(frame.cameraFieldOfView - (30 + expectedX(frame.dancePosition) * 5)) < .15), "KHR_animation_pointer must animate the lens on the same clock");
  assert.ok(tracked.some(frame => frame.dancePosition > 2.1 && frame.cameraOrthographic), "GLB shot selection must switch projection");
  assert.equal(final.cameraOrthographic, false, "Reset must restore the prior projection");
  assert.ok(tracked.some(frame => frame.dancePosition > 1.1 && frame.dancePosition < 1.9), "Capture must observe the interval before the camera switch");
  assert.ok(baseline && distance(baseline, final.cameraPosition) < .02, "Reset must restore prior camera framing");
  assert.ok(moving.some(frame => distance(baseline, frame.cameraPosition) > .05), "The camera must actually move");
  assert.ok(!final.dancing && !final.immersive, "Playback must release ownership without switching presentation mode");
  assert.equal(final.subtitle, "", "Reset must clear music subtitles");
  const result = { passed: true, noMedia: true, configuredAudioAndCamera: true, mediaClockSampleCount: moving.length, actualMotion: true, cameraRestored: true, dialogueIndependent: true, busyRejected: true, missingMediaRejected: true, failedValidationPreserved: true, resetReportedInterruption: true, terminalEvents: messages.filter(message => message.type === "dance").map(({ id, actionId, status, error }) => ({ id, actionId, status, ...(error ? { error } : {}) })) };
  await writeFile(join(output, "acceptance.json"), JSON.stringify(result, null, 2));
  console.log("[dance-player] true start and terminal feedback passed: " + output);
} finally {
  clearTimeout(lifetime); connection?.destroy(); server.close(); child?.kill();
  if (child && child.exitCode === null) await new Promise(resolve => child.once("exit", resolve));
  // Keep measurements and results, remove only this run's bulky capture images/audio.
  for (const file of await readdir(output)) {
    if (!/\.(jpg|f32)$/i.test(file)) continue;
    const capture = join(output, file); if ((await stat(capture)).isFile()) await unlink(capture);
  }
}
