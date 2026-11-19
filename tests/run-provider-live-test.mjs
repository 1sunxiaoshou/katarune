import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import electronPath from "electron";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));

export function runProviderLiveTest(entry, requiredEnvironment, { skipWithoutCredentials = true } = {}) {
  try {
    process.loadEnvFile(join(projectRoot, ".env.local"));
  } catch (error) {
    if (error?.code !== "ENOENT" || !skipWithoutCredentials) throw error;
  }
  const missing = requiredEnvironment.filter(name => !process.env[name]);
  if (missing.length > 0) {
    const message = `${missing.join(", ")} missing from the environment or .env.local.`;
    if (!skipWithoutCredentials) throw new Error(message);
    console.log(`Skipping paid validation for ${entry}: ${message}`);
    return;
  }

  const testRoot = join(projectRoot, ".test-dist");
  mkdirSync(testRoot, { recursive: true });
  const outputDirectory = mkdtempSync(join(testRoot, `${entry}-`));
  try {
    const build = spawnSync(process.execPath, [
      join(projectRoot, "node_modules", "vite", "bin", "vite.js"),
      "build",
      "--ssr",
      join(projectRoot, "tests", `${entry}.integration.ts`),
      "--outDir",
      outputDirectory,
    ], { cwd: projectRoot, stdio: "inherit" });
    if (build.error) throw build.error;
    if (build.status !== 0) {
      process.exitCode = build.status ?? 1;
      return;
    }

    const bundle = join(outputDirectory, `${entry}.integration.js`);
    const result = spawnSync(electronPath, [bundle], {
      cwd: projectRoot,
      stdio: "inherit",
    });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exitCode = result.status ?? 1;
  } finally {
    rmSync(outputDirectory, { recursive: true, force: true });
  }
}
