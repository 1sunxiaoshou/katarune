import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import electronPath from "electron";

const root = resolve(import.meta.dirname, "..");
const output = join(root, ".test-dist", "sqlite-gc-runs");
mkdirSync(output, { recursive: true });
const directory = mkdtempSync(join(output, "run-"));
mkdirSync(join(directory, "user-data"));
mkdirSync(join(directory, "session-data"));
const { ELECTRON_RUN_AS_NODE: _runAsNode, ...environment } = process.env;
try {
  for (const [name, executable, runAsNode] of [
    ["Node", process.execPath, false], ["Electron Node", electronPath, true], ["Electron main", electronPath, false],
  ]) {
    const result = spawnSync(executable, [join(root, "tests", "sqlite-gc.integration.cjs")], {
      cwd: root, windowsHide: true, encoding: "utf8", timeout: 60_000,
      env: { ...environment, KATARUNE_SQLITE_GC_TEST_DIR: directory, ...(runAsNode ? { ELECTRON_RUN_AS_NODE: "1" } : {}) },
    });
    assert.ifError(result.error);
    assert.equal(result.signal, null);
    assert.equal(result.status, 0, `${name} failed: ${result.stderr}`);
    assert.match(result.stdout, /passed 100000 statements/);
    console.log(`[sqlite-gc] ${name}: ${result.stdout.trim()}`);
  }
} finally {
  assert.ok(resolve(directory).startsWith(`${resolve(output)}${sep}`));
  rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
