import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync } from "node:fs";
import { resolve, join } from "node:path";
import electronPath from "electron";

const root = resolve(import.meta.dirname, "..");
const output = join(root, ".test-dist", "startup-runs");
mkdirSync(output, { recursive: true });
const directory = mkdtempSync(join(output, "run-"));
mkdirSync(join(directory, "session-data"));
const { ELECTRON_RENDERER_URL: _devUrl, ...environment } = process.env;
const child = spawn(
  electronPath,
  [join(root, "tests", "startup.integration.mjs")],
  {
    cwd: root,
    windowsHide: true,
    stdio: "inherit",
    env: { ...environment, KATARUNE_STARTUP_TEST_DIR: directory },
  },
);
child.once("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.once("exit", (code) => {
  process.exitCode = code ?? 1;
});
