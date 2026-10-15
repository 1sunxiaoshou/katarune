import assert from "node:assert/strict";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { once } from "node:events";
import { writeFile } from "node:fs/promises";
import { app, BrowserWindow, screen } from "electron";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const directory = process.env.KATARUNE_STARTUP_TEST_DIR;
assert.ok(directory, "An isolated startup test directory is required");
app.setAppPath(process.cwd());
app.setPath("userData", join(directory, "user-data"));
app.setPath("sessionData", join(directory, "session-data"));

let passed = false;
const timeout = setTimeout(() => {
  console.error(
    "[startup] Main window and Unity default character did not become ready within 90 seconds",
  );
  app.exit(1);
}, 90_000);

app.once("browser-window-created", async (_event, window) => {
  try {
    await Promise.all([
      once(window, "ready-to-show"),
      once(window.webContents, "did-finish-load"),
    ]);
    assert.equal(
      window.isVisible(),
      true,
      "The real main window must be visible, including when launched with windowsHide",
    );
    await window.webContents
      .executeJavaScript(`new Promise((resolve, reject) => {
        const deadline = Date.now() + 5000;
        const check = () => {
          if (document.querySelector('#root')?.childElementCount > 0) return resolve();
          if (Date.now() > deadline) return reject(new Error('Renderer did not mount'));
          setTimeout(check, 20);
        };
        check();
      })`);
    const state = await window.webContents.executeJavaScript(`window.katarune.getAppState()`);
    assert.equal(state.activeCharacter.packageId, "builtin:default");
    assert.notEqual(state.activeCharacter.packageThumbnailAssetId, state.activeCharacter.packagePortraitAssetId);
    const wait = selector => window.webContents.executeJavaScript(`new Promise((resolve, reject) => {
      const deadline = Date.now() + 5000; const check = () => { const element = document.querySelector(${JSON.stringify(selector)});
        if (element && (!(element instanceof HTMLImageElement) || (element.complete && element.naturalWidth > 0))) return resolve();
        if (Date.now() > deadline) return reject(new Error('Missing or unloaded ' + ${JSON.stringify(selector)})); setTimeout(check, 20); }; check();
    })`);
    await wait('.chat-character-entry .character-list-portrait img');
    const verifyCard = async selector => {
      const image = await window.webContents.executeJavaScript(`(() => { const element = document.querySelector(${JSON.stringify(selector)}); const rect = element.parentElement.getBoundingClientRect(); return { src: element.src, width: rect.width, height: rect.height }; })()`);
      assert.ok(image.src.endsWith(state.activeCharacter.packageThumbnailAssetId));
      assert.ok(Math.abs(image.width - image.height) < 1);
    };
    await verifyCard('.chat-character-entry .character-list-portrait img');
    window.webContents.send("character-packages:open", state.activeCharacter.id);
    await wait('[data-testid="character-package-dialog"] .character-package-art img');
    await verifyCard('[data-testid="character-list-item"] .character-list-portrait img');
    await new Promise(resolve => setTimeout(resolve, 350)); // Allow the 200 ms entry transition to paint before capture.
    await writeFile(join(directory, "character-packages.png"), (await window.capturePage()).toPNG());
    const binding = { characterId: state.activeCharacter.id, threadId: "startup-avatar-regression" };
    await window.webContents.executeJavaScript(`window.katarune.initializeThread(${JSON.stringify(binding)})`);
    const avatar = await window.webContents.executeJavaScript(`window.katarune.startAvatar(${JSON.stringify(binding)})`);
    assert.equal(avatar.phase, "ready", "The default package must pass the real Unity-to-main message validation");
    assert.equal(avatar.error, null);
    await new Promise(resolve => setTimeout(resolve, 1000));
    const settledAvatar = await window.webContents.executeJavaScript(`window.katarune.getAvatarStatus()`);
    assert.equal(settledAvatar.phase, "ready", "Subsequent Unity control messages must preserve the connection");
    assert.equal(settledAvatar.error, null);
    const until = async (condition, message) => {
      const deadline = Date.now() + 5000;
      while (!await condition()) {
        assert.ok(Date.now() < deadline, message);
        await new Promise(resolve => setTimeout(resolve, 20));
      }
    };
    const desktopWindow = surface => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes(`surface=${surface}`));
    await until(() => desktopWindow("capsule")?.isVisible(), "Capsule did not become visible");
    const capsule = desktopWindow("capsule"), panel = desktopWindow("panel");
    await until(() => capsule.webContents.executeJavaScript(`!!document.querySelector('button[aria-label="更多"]')`), "Capsule buttons did not mount");
    assert.equal(capsule.isFocused(), false);
    const capsuleBounds = capsule.getBounds();
    const more = await capsule.webContents.executeJavaScript(`(() => { const r = document.querySelector('button[aria-label="更多"]').getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })()`);
    const clickMore = async () => {
      const point = screen.dipToScreenPoint({ x: capsuleBounds.x + more.x, y: capsuleBounds.y + more.y });
      const { stdout } = await promisify(execFile)("pwsh", ["-NoProfile", "-File", resolve("tests/native-desktop-click.ps1"),
        "-X", String(point.x), "-Y", String(point.y), "-WindowHandle", String(capsule.getNativeWindowHandle().readBigUInt64LE()),
        "-OwnerProcessId", String(process.pid)], { windowsHide: true, timeout: 10_000 });
      const native = JSON.parse(stdout);
      assert.ok(native.clicked, "An unrelated window occluded the owned test windows; no click was sent");
    };
    const panelPainted = () => panel.webContents.executeJavaScript(`(() => { const element = document.querySelector('.desktop-panel'); return element?.dataset.phase === 'open' && Number(getComputedStyle(element).opacity) > .99; })()`);
    // A hidden native window may stop delivering animation frames. Opening must
    // depend on committed DOM, rather than waiting for an invisible paint.
    await panel.webContents.executeJavaScript(`window.startupOriginalRaf = window.requestAnimationFrame; window.requestAnimationFrame = () => 0; void 0;`);
    await clickMore();
    await until(() => panel.isVisible(), "First click must open the panel without dragging the capsule");
    await until(panelPainted, "Panel content must actually become visible after the first click");
    await panel.webContents.executeJavaScript(`window.requestAnimationFrame = window.startupOriginalRaf; delete window.startupOriginalRaf;`);
    assert.deepEqual(capsule.getBounds(), capsuleBounds);
    assert.equal((await panel.webContents.executeJavaScript(`window.avatarDesktop.getState()`)).panelPhase, "open");
    await panel.webContents.executeJavaScript(`window.avatarDesktop.command({ operation: "close-panel" })`);
    assert.equal(panel.isVisible(), false);
    window.focus();
    await clickMore();
    await until(() => panel.isVisible(), "Panel must reopen on the next click");
    await until(panelPainted, "Reopened panel content must paint");
    await writeFile(join(directory, "desktop-panel.png"), (await panel.capturePage()).toPNG());
    const openedPanel = await panel.webContents.executeJavaScript(`window.avatarDesktop.getState()`);
    window.focus();
    await until(() => !panel.isVisible(), "Clicking away must still dismiss the panel");
    await panel.webContents.executeJavaScript(`window.avatarDesktop.command({ operation: "panel-ready", value: ${JSON.stringify(String(openedPanel.panelRevision))} })`);
    assert.equal(panel.isVisible(), false, "A stale readiness message must not reopen a closed panel");
    await writeFile(join(directory, "avatar-startup.json"), JSON.stringify({ avatar, settledAvatar }, null, 2));
    const stoppedAvatar = await window.webContents.executeJavaScript(`window.katarune.stopAvatar()`);
    assert.equal(stoppedAvatar.phase, "stopped");
    passed = true;
    console.log("[startup] Actual main window, builtin package dialog, default Unity avatar and first-click panel open/reopen/dismiss without dragging passed: " + directory);
  } catch (error) {
    console.error(error);
  } finally {
    clearTimeout(timeout);
    app.quit();
  }
});
app.once("will-quit", () => {
  if (!passed) app.exit(1);
});
await import(pathToFileURL(resolve("out/main/index.js")).href);
