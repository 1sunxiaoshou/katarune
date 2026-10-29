import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve, join } from "node:path";
import electronPath from "electron";

const root = resolve(import.meta.dirname, "..");
const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).devDependencies.electron;
mkdirSync(join(root, ".test-dist"), { recursive: true });
const directory = mkdtempSync(join(root, ".test-dist/electron-shutdown-"));
const fixture = join(root, "tests/electron-shutdown.fixture.mjs");
try {
  for (let index = 0; index < 6; index++) {
    const expected = index === 5 ? 1 : 0;
    const profile = join(directory, String(index));
    mkdirSync(profile);
    const result = spawnSync(electronPath, [fixture, ...(expected ? ["--fail"] : [])], {
      cwd: root, windowsHide: true, encoding: "utf8", timeout: 10_000,
      env: { ...process.env, KATARUNE_SHUTDOWN_TEST_DIR: profile },
    });
    assert.ifError(result.error);
    assert.equal(result.signal, null);
    assert.match(result.stdout, new RegExp(`workload complete; electron=.*; exit=${expected}`));
    assert.ok(result.stdout.includes(`electron=${version};`), "Installed Electron differs from the pinned dependency");
    assert.equal(result.status, expected, result.stderr);
    assert.doesNotMatch(result.stderr, /PostQueuedCompletionStatus|uv_fatal_error/);
    console.log(`[electron-shutdown] ${index + 1}/6: expected exit ${expected}, got ${result.status}`);
  }
} finally {
  rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
