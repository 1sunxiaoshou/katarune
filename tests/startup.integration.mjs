import assert from "node:assert/strict";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { once } from "node:events";
import { writeFile } from "node:fs/promises";
import { app } from "electron";

const directory = process.env.KATARUNE_STARTUP_TEST_DIR;
assert.ok(directory, "An isolated startup test directory is required");
app.setAppPath(process.cwd());
app.setPath("userData", join(directory, "user-data"));
app.setPath("sessionData", join(directory, "session-data"));

let passed = false;
const timeout = setTimeout(() => {
  console.error(
    "[startup] Main window did not become visible and render within 20 seconds",
  );
  app.exit(1);
}, 20_000);

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
    passed = true;
    console.log("[startup] Actual main window, builtin offline package dialog, image decoding and both 1:1 thumbnail cards passed: " + join(directory, "character-packages.png"));
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
