import { rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import electronPath from "electron";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const outputDirectory = join(projectRoot, ".test-dist", "database");
const viteCli = join(projectRoot, "node_modules", "vite", "bin", "vite.js");
const testEntry = join(projectRoot, "tests", "database-runtime.integration.ts");

try {
  const build = spawnSync(
    process.execPath,
    [viteCli, "build", "--ssr", testEntry, "--outDir", outputDirectory, "--emptyOutDir"],
    { cwd: projectRoot, stdio: "inherit" },
  );
  if (build.status !== 0) process.exitCode = build.status ?? 1;

  if (process.exitCode === undefined) {
    const testBundle = join(outputDirectory, "database-runtime.integration.js");
    const test = spawnSync(electronPath, [testBundle], {
      cwd: projectRoot,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      stdio: "inherit",
    });
    if (test.status !== 0) process.exitCode = test.status ?? 1;
  }
} finally {
  rmSync(resolve(projectRoot, ".test-dist"), { recursive: true, force: true });
}
