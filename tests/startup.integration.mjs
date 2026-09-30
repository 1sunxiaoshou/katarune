import assert from "node:assert/strict";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { once } from "node:events";
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
    passed = true;
    console.log("[startup] Actual main window is visible and renderer mounted");
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
