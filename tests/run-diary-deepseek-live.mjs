import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import electronPath from "electron";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
for (const file of [".env.local", ".env"]) {
  if (existsSync(join(root, file))) { process.loadEnvFile(join(root, file)); break; }
}
const testRoot = join(root, ".test-dist");
mkdirSync(testRoot, { recursive: true });
const output = mkdtempSync(join(testRoot, "diary-deepseek-live-"));
try {
  const build = spawnSync(process.execPath, [join(root, "node_modules/vite/bin/vite.js"), "build", "--ssr", "tests/diary-deepseek-live.integration.ts", "--outDir", output, "--emptyOutDir"], { cwd: root, stdio: "inherit" });
  if (build.status !== 0) process.exitCode = build.status ?? 1;
  else {
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const result = spawnSync(electronPath, [join(output, "diary-deepseek-live.integration.js")], { cwd: root, stdio: "inherit", env });
    process.exitCode = result.status ?? 1;
  }
} finally { rmSync(output, { recursive: true, force: true }); }
