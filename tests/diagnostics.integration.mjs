import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { app, BrowserWindow, dialog } from "electron";
import { Diagnostics } from "../src/main/diagnostics/logger";
import { registerDiagnosticsHandlers } from "../src/main/diagnostics/handlers";

const directory = process.env.KATARUNE_DIAGNOSTICS_TEST_DIR;
assert.ok(directory);
app.setPath("userData", join(directory, "user-data"));
app.commandLine.appendSwitch("disable-gpu");
const logger = new Diagnostics(join(directory, "logs"), "0.1.0-test");
logger.start(process.env.KATARUNE_DIAGNOSTICS_WRITER_PATH ?? resolve("out/main/diagnosticWriter.js"));
registerDiagnosticsHandlers(logger);
void app.whenReady().then(async () => {
const window = new BrowserWindow({ show: false, webPreferences: { preload: resolve("out/preload/index.cjs"), sandbox: true, contextIsolation: true, nodeIntegration: false } });
try {
  await window.loadURL("data:text/html,<html><body>Diagnostics integration</body></html>");
  const initial = await window.webContents.executeJavaScript("window.katarune.getDiagnosticsStatus()");
  assert.equal(initial.debugUntil, 0);
  const debug = await window.webContents.executeJavaScript("window.katarune.setDiagnosticsDebug(true)");
  assert.ok(debug.debugUntil > Date.now());
  await assert.rejects(window.webContents.executeJavaScript("window.katarune.setDiagnosticsDebug('secret-invalid-input')"), /原因码：invalid-input/);
  await window.webContents.executeJavaScript(`window.katarune.reportDiagnostic({ event: 'renderer.error', error: { name: 'TypeError', frames: ['src/renderer/src/main.tsx:1:1'], messageRedacted: true }, message: 'private chat', token: 'secret-token', source: 'main' })`);
  await new Promise(resolve => setTimeout(resolve, 100));
  await logger.flush();
  const events = (await readFile(join(directory, "logs", "events.jsonl"), "utf8")).trim().split("\n").map(line => JSON.parse(line));
  assert.ok(events.some(event => event.event === "renderer.error" && event.source === "renderer" && event.incidentId));
  assert.ok(events.some(event => event.event === "diagnostics.debug.rejected" && event.level === "warn" && event.reasonCode === "invalid-input" && !event.incidentId && !event.error));
  assert.doesNotMatch(JSON.stringify(events), /secret-invalid-input/);
  assert.doesNotMatch(JSON.stringify(events), /private chat|secret-token/);
  await window.webContents.executeJavaScript(`for (let i = 0; i < 500; i++) window.katarune.reportDiagnostic({event: 'renderer.error', error: {name: 'TypeError', frames: [], messageRedacted: true}})`);
  await new Promise(resolve => setTimeout(resolve, 150));
  await window.webContents.executeJavaScript(`window.katarune.reportDiagnostic({event: 'renderer.rejection', error: {name: 'Error', frames: [], messageRedacted: true}})`);
  await new Promise(resolve => setTimeout(resolve, 100));
  const target = join(directory, "export.json");
  const originalMessageBox = dialog.showMessageBox, originalSaveDialog = dialog.showSaveDialog;
  dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false });
  dialog.showSaveDialog = async () => ({ canceled: false, filePath: target });
  try {
    assert.deepEqual(await window.webContents.executeJavaScript("window.katarune.exportDiagnostics({hours: 1})"), { status: "success" });
    const exported = JSON.parse(await readFile(target, "utf8"));
    assert.ok(exported.events.some(event => event.event === "diagnostics.source-dropped" && event.count > 0));
    assert.ok(exported.manifest.excludes.includes("raw-engine-logs"));
    assert.ok(exported.events.some(event => event.reasonCode === "invalid-input" && event.outcome === "rejected"));
    assert.doesNotMatch(JSON.stringify(exported), /private chat|secret-token/);
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
    assert.deepEqual(await window.webContents.executeJavaScript("window.katarune.exportDiagnostics({hours: 24})"), { status: "cancelled" });
  } finally { dialog.showMessageBox = originalMessageBox; dialog.showSaveDialog = originalSaveDialog; }
  await window.webContents.executeJavaScript("window.katarune.setDiagnosticsDebug(false)");
  const gone = new Promise(resolve => window.webContents.once("render-process-gone", resolve));
  window.webContents.forcefullyCrashRenderer(); await gone;
  await logger.close(true);
  assert.match(await readFile(join(directory, "logs", "events.jsonl"), "utf8"), /renderer.process-gone/);
  await writeFile(join(directory, "result.json"), JSON.stringify({ passed: true, checks: ["renderer-boundary", "privacy", "rate-limit", "debug", "export", "cancel-export", "renderer-crash", "flush"] }));
  console.log("[diagnostics] Passed renderer IPC, privacy, rate limiting, local export, cancellation and renderer crash capture.");
  app.exit(0);
} catch (error) {
  console.error(error); await logger.close(false); app.exit(1);
}

});
