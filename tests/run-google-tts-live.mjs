import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import electronPath from "electron";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const outputDirectory = join(projectRoot, ".test-dist", "google-tts-live");
const viteCli = join(projectRoot, "node_modules", "vite", "bin", "vite.js");
const testEntry = join(projectRoot, "tests", "google-tts-live.integration.ts");

try {
  try {
    process.loadEnvFile(join(projectRoot, ".env.local"));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  if (!process.env.KATARUNE_TEST_GOOGLE_API_KEY) {
    console.log(
      "Skipping paid Google Gemini TTS validation: KATARUNE_TEST_GOOGLE_API_KEY is not configured in .env.local.",
    );
  } else {
    const build = spawnSync(
      process.execPath,
      [
        viteCli,
        "build",
        "--ssr",
        testEntry,
        "--outDir",
        outputDirectory,
        "--emptyOutDir",
      ],
      { cwd: projectRoot, stdio: "inherit" },
    );
    if (build.status !== 0) process.exitCode = build.status ?? 1;

    if (process.exitCode === undefined) {
      const testBundle = join(
        outputDirectory,
        "google-tts-live.integration.js",
      );
      const test = spawnSync(electronPath, [testBundle], {
        cwd: projectRoot,
        env: process.env,
        stdio: "inherit",
      });
      if (test.status !== 0) process.exitCode = test.status ?? 1;
    }
  }
} finally {
  rmSync(resolve(projectRoot, ".test-dist"), {
    recursive: true,
    force: true,
  });
}
