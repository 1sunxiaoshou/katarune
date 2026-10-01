import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";
import electronPath from "electron";
const root = process.cwd(),
  output = join(root, ".test-dist", "character-packages");
try {
  const build = spawnSync(
    process.execPath,
    [
      join(root, "node_modules/vite/bin/vite.js"),
      "build",
      "--ssr",
      "tests/character-package.integration.ts",
      "--outDir",
      output,
      "--emptyOutDir",
    ],
    { stdio: "inherit", cwd: root },
  );
  if (build.status !== 0) process.exitCode = build.status ?? 1;
  else {
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const run = spawnSync(
      electronPath,
      [join(output, "character-package.integration.js")],
      { env, stdio: "inherit", windowsHide: true, timeout: 60000 },
    );
    process.exitCode = run.status ?? 1;
  }
} finally {
  rmSync(output, { force: true, recursive: true });
}
