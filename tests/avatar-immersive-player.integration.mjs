import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, stat, writeFile, readFile } from "node:fs/promises";
import { resolve, join, dirname } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

// Real visible Player, default local model; no provider calls or personal data.
const executable = resolve("unity/KataruneAvatar/Builds/Windows/KataruneAvatar.exe");
const output = resolve(".test-dist/immersive-player");
await mkdir(output, { recursive: true });
const native = async (processId = 0) => JSON.parse((await promisify(execFile)("pwsh", [
  "-NoProfile", "-File", resolve("tests/native-avatar-window.ps1"), "-AvatarProcessId", String(processId),
], { windowsHide: true, timeout: 10_000 })).stdout);
const rect = await native();
const results = [];
for (const cameraView of ["overhead", "center", "closeup"]) {
  const pipe = `katarune-immersive-test-${randomUUID()}`;
  const capture = join(output, `${cameraView}.png`);
  const log = join(output, `${cameraView}.log`);
  let socket, child, failure;
  const messages = [];
  const server = createServer(connection => {
    socket = connection;
    connection.setEncoding("utf8");
    let buffer = "";
    connection.on("data", chunk => {
      buffer += chunk;
      let end;
      while ((end = buffer.indexOf("\n")) >= 0) {
        messages.push(JSON.parse(buffer.slice(0, end)));
        buffer = buffer.slice(end + 1);
      }
    });
  });
  const until = async (condition, description) => {
    const deadline = Date.now() + 30_000;
    while (!await condition()) {
      if (failure) throw failure;
      assert.ok(Date.now() < deadline, description);
      await delay(30);
    }
  };
  try {
    await new Promise(resolve => server.listen(`\\\\.\\pipe\\${pipe}`, resolve));
    const started = Date.now();
    child = spawn(executable, ["-force-d3d11", "-force-d3d11-bitblt-model", "-screen-fullscreen", "1",
      "-window-mode", "borderless", "-logFile", log, "--screenshot", capture, "--capture-delay", "5", "--exit-on-error"], {
      cwd: dirname(executable), windowsHide: true, stdio: "ignore",
      env: { ...process.env, KATARUNE_AVATAR_PIPE: pipe },
    });
    child.on("error", error => { failure = error; });
    child.on("exit", code => { failure = new Error(`Player exited early: ${code}`); });
    await until(() => messages.some(m => m.type === "ready"), "Player did not become ready");
    const layout = async (mode, view = cameraView, applyGeometry = false) => {
      const requestId = randomUUID();
      socket.write(JSON.stringify({ type: "window-layout", value: JSON.stringify({
        requestId, mode, cameraView: view, applyGeometry, rect, adjusting: false,
        x: .78, y: .5, height: .65, yaw: 18, pitch: 4,
      }) }) + "\n");
      await until(() => messages.some(m => m.type === "window-state" && m.requestId === requestId), "Layout acknowledgement missing");
      return messages.find(m => m.type === "window-state" && m.requestId === requestId);
    };
    const desktop = await layout("desktop", cameraView, true);
    const entered = await layout("immersive");
    assert.equal(entered.mode, "immersive");
    assert.equal(entered.cameraView, cameraView);
    await delay(1200);
    const immersiveWindow = await native(child.pid);
    assert.equal(immersiveWindow.topmost, false);
    assert.equal(immersiveWindow.toolWindow, false);
    assert.equal(immersiveWindow.appWindow, true);
    assert.equal(immersiveWindow.clickThrough, false);
    for (const field of ["x", "y", "width", "height"]) assert.equal(immersiveWindow[field], rect[field]);
    await until(async () => (await stat(capture).catch(() => null))?.mtimeMs > started, "Player screenshot missing");
    assert.ok((await stat(capture)).size > 20_000);
    const restored = await layout("desktop");
    await delay(1100);
    const desktopWindow = await native(child.pid);
    assert.equal(desktopWindow.topmost, true);
    assert.equal(desktopWindow.toolWindow, true);
    assert.equal(desktopWindow.appWindow, false);
    assert.equal(desktopWindow.clickThrough, true);
    for (const field of ["x", "y", "height", "yaw", "pitch"]) assert.equal(restored[field], desktop[field]);
    const playerLog = await readFile(log, "utf8");
    assert.doesNotMatch(playerLog, /Shader error|NullReferenceException|ArgumentException/);
    results.push({ cameraView, immersiveWindow, desktopWindow, restored: true });
  } finally {
    socket?.destroy();
    server.close();
    if (child && child.exitCode === null) {
      const exited = new Promise(resolve => child.once("exit", resolve));
      child.kill();
      await exited;
    }
  }
}
await writeFile(join(output, "result.json"), JSON.stringify(results, null, 2));
console.log("[immersive] Three real Player presets, native window policies, screenshots and desktop restoration passed.");
