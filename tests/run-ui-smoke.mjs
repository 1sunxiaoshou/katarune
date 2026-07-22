import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import electronPath from "electron";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const testEntry = resolve(projectRoot, "tests", "ui-smoke.integration.mjs");
const outputDirectory = join(projectRoot, ".test-dist", "ui-smoke");
const viteCli = join(projectRoot, "node_modules", "vite", "bin", "vite.js");

try {
  const build = spawnSync(
    process.execPath,
    [viteCli, "build", "--ssr", testEntry, "--outDir", outputDirectory, "--emptyOutDir"],
    { cwd: projectRoot, stdio: "inherit" },
  );
  if (build.status !== 0) process.exitCode = build.status ?? 1;

  if (process.exitCode === undefined) {
    const testBundle = join(outputDirectory, "ui-smoke.integration.js");
    const result = spawnSync(electronPath, [testBundle], {
      cwd: projectRoot,
      stdio: "inherit",
    });

    if (result.status !== 0) process.exitCode = result.status ?? 1;
  }
} finally {
  rmSync(resolve(projectRoot, ".test-dist"), { recursive: true, force: true });
}
