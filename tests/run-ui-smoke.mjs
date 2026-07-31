import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import electronPath from "electron";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const testEntry = resolve(projectRoot, "tests", "ui-smoke.integration.mjs");
const testRunsDirectory = join(projectRoot, ".test-dist", "ui-smoke-runs");
const viteCli = join(projectRoot, "node_modules", "vite", "bin", "vite.js");

mkdirSync(testRunsDirectory, { recursive: true });
const runDirectory = mkdtempSync(join(testRunsDirectory, "run-"));
const outputDirectory = join(runDirectory, "bundle");
let activeChild;

function stopProcessTree(child) {
  if (child?.pid === undefined || child.exitCode !== null) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
    return;
  }
  child.kill("SIGTERM");
}

function runProcess(label, command, args, timeoutMs, env = process.env) {
  return new Promise((resolveRun, rejectRun) => {
    const startedAt = performance.now();
    console.log(`[ui-smoke] ${label}: start`);
    const child = spawn(command, args, {
      cwd: projectRoot,
      env,
      stdio: "inherit",
      windowsHide: true,
    });
    activeChild = child;
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      stopProcessTree(child);
    }, timeoutMs);

    child.once("error", (error) => {
      clearTimeout(timeout);
      activeChild = undefined;
      rejectRun(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timeout);
      activeChild = undefined;
      const elapsedMs = Math.round(performance.now() - startedAt);
      if (timedOut) {
        rejectRun(new Error(`${label} timed out after ${timeoutMs} ms`));
        return;
      }
      if (code !== 0) {
        rejectRun(
          new Error(
            `${label} exited with code ${code ?? "null"} (${signal ?? "no signal"})`,
          ),
        );
        return;
      }
      console.log(`[ui-smoke] ${label}: pass (${elapsedMs} ms)`);
      resolveRun();
    });
  });
}

const stopOnSignal = () => {
  stopProcessTree(activeChild);
  process.exitCode = 1;
};
process.once("SIGINT", stopOnSignal);
process.once("SIGTERM", stopOnSignal);

try {
  await runProcess(
    "bundle test entry",
    process.execPath,
    [viteCli, "build", "--ssr", testEntry, "--outDir", outputDirectory, "--emptyOutDir"],
    30_000,
  );

  await runProcess(
    "Electron journeys",
    electronPath,
    [join(outputDirectory, "ui-smoke.integration.js")],
    90_000,
    {
      ...process.env,
      KATARUNE_UI_TEST_RUN_DIR: runDirectory,
    },
  );
} catch (error) {
  process.exitCode = 1;
  console.error(`[ui-smoke] ${error instanceof Error ? error.message : String(error)}`);
} finally {
  stopProcessTree(activeChild);
  rmSync(runDirectory, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  });
}
