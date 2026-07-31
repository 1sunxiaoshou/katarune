import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawn } from "node:child_process";

const executablePath = resolve(
  process.argv[2] ?? "dist-verify/win-unpacked/Katarune.exe",
);
const isolatedDataRoot = mkdtempSync(`${tmpdir()}\\katarune-packaged-asset-`);

async function availablePort() {
  const server = createServer();
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  assert.notEqual(address, null);
  assert.equal(typeof address, "object");
  const port = address.port;
  await new Promise((resolveClose, reject) =>
    server.close((error) => (error === undefined ? resolveClose() : reject(error))),
  );
  return port;
}

async function waitForPage(port) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) =>
        response.json(),
      );
      const page = pages.find((entry) => entry.type === "page");
      if (page?.webSocketDebuggerUrl !== undefined) return page;
    } catch {
      // The packaged app has not opened its debugging endpoint yet.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error("Timed out waiting for the packaged renderer.");
}

async function evaluate(webSocketDebuggerUrl, expression) {
  const socket = new WebSocket(webSocketDebuggerUrl);
  await new Promise((resolveOpen, reject) => {
    socket.addEventListener("open", resolveOpen, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  try {
    const result = await new Promise((resolveMessage, reject) => {
      socket.addEventListener("message", (event) => {
        const message = JSON.parse(event.data);
        if (message.id !== 1) return;
        if (message.error !== undefined) reject(new Error(message.error.message));
        else resolveMessage(message.result);
      });
      socket.send(
        JSON.stringify({
          id: 1,
          method: "Runtime.evaluate",
          params: {
            expression,
            awaitPromise: true,
            returnByValue: true,
          },
        }),
      );
    });
    if (result.exceptionDetails !== undefined) {
      throw new Error(result.exceptionDetails.text);
    }
    return result.result.value;
  } finally {
    socket.close();
  }
}

const port = await availablePort();
const child = spawn(
  executablePath,
  [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${isolatedDataRoot}`,
  ],
  {
    env: {
      ...process.env,
      APPDATA: isolatedDataRoot,
      LOCALAPPDATA: isolatedDataRoot,
    },
    stdio: "ignore",
    windowsHide: true,
  },
);

try {
  const page = await waitForPage(port);
  const result = await evaluate(
    page.webSocketDebuggerUrl,
    `(async () => {
      const deadline = Date.now() + 15000;
      let image;
      while (Date.now() < deadline) {
        image = document.querySelector('[data-testid="character-launcher"] img');
        if (image?.complete && image.naturalWidth > 0) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      const state = await window.katarune.getAppState();
      return {
        activeCharacter: state.activeCharacter.name,
        imageSource: image?.src ?? null,
        imageWidth: image?.naturalWidth ?? 0,
      };
    })()`,
  );
  assert.equal(result.activeCharacter, "春原心奈");
  assert.match(result.imageSource, /^katarune-asset:\/\/asset\/[0-9a-f-]+$/);
  assert.ok(result.imageWidth > 0);
  console.log("Packaged default portrait loaded through katarune-asset.");
} finally {
  child.kill();
  await new Promise((resolveExit) => {
    if (child.exitCode !== null) resolveExit();
    else child.once("exit", resolveExit);
  });
  rmSync(isolatedDataRoot, { recursive: true, force: true });
}
