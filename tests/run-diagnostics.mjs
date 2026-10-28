import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, copyFile, cp } from "node:fs/promises";
import assert from "node:assert/strict";
import { resolve, join } from "node:path";
import { build } from "esbuild";
import electronPath from "electron";
import { createPackage } from "@electron/asar";
const root = resolve(import.meta.dirname, "..");
await mkdir(join(root, ".test-dist", "diagnostics-runs"), { recursive: true });
const directory = await mkdtemp(join(root, ".test-dist", "diagnostics-runs", "run-"));
const entry = join(directory, "integration.mjs");
const packageDirectory = join(directory, "asar-source");
await mkdir(join(packageDirectory, "out", "main"), { recursive: true });
await copyFile(join(root, "out", "main", "diagnosticWriter.js"), join(packageDirectory, "out", "main", "diagnosticWriter.js"));
await cp(join(root, "node_modules", "electron-log"), join(packageDirectory, "node_modules", "electron-log"), { recursive: true });
await writeFile(join(packageDirectory, "package.json"), JSON.stringify({ type: "module" }));
await createPackage(packageDirectory, join(directory, "app.asar"));
await build({ entryPoints: [join(root, "tests", "diagnostics.integration.mjs")], outfile: entry, bundle: true, platform: "node", format: "esm", packages: "external", banner: { js: "const __dirname = import.meta.dirname;" } });
const child = spawn(electronPath, [entry], { cwd: root, windowsHide: true, stdio: "inherit", env: { ...process.env, KATARUNE_DIAGNOSTICS_TEST_DIR: directory, KATARUNE_DIAGNOSTICS_WRITER_PATH: join(directory, "app.asar", "out", "main", "diagnosticWriter.js") } });
const timer = setTimeout(() => { child.kill(); process.exitCode = 1; }, 30_000);
child.on("error", () => { clearTimeout(timer); process.exitCode = 1; });
child.on("exit", code => {
  clearTimeout(timer); process.exitCode = code ?? 1;
  if (code !== 0) return;
  const fatal = spawn(electronPath, [join(root, "tests", "diagnostics-fatal.integration.mjs")], { cwd: root, windowsHide: true, stdio: "inherit", env: { ...process.env, KATARUNE_DIAGNOSTICS_TEST_DIR: directory } });
  const fatalTimer = setTimeout(() => { fatal.kill(); process.exitCode = 1; }, 10_000);
  fatal.on("error", () => { clearTimeout(fatalTimer); process.exitCode = 1; });
  fatal.on("exit", async code => {
    clearTimeout(fatalTimer);
    try {
      assert.equal(code, 1, "Main fatal errors must exit nonzero");
      const path = join(directory, "fatal-user-data-development", "logs", "diagnostics");
      const logs = await readFile(join(path, "events.jsonl"), "utf8");
      assert.match(logs, /app.uncaught-exception/); assert.match(logs, /ECONNRESET/);
      assert.doesNotMatch(logs, /secret-fixture-never-persist/);
      assert.ok(await readFile(join(path, "session.pending"), "utf8"));
      console.log("[diagnostics] Passed fatal Main flush, nonzero exit and unclean marker.");
    } catch (error) { console.error(error); process.exitCode = 1; }
  });
});
