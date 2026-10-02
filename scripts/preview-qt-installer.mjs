import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync, spawn } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const payload = join(root, "build/installer-preview/payload");
const output = join(root, "build/installer-preview/Katarune-UI-Preview.exe");
mkdirSync(payload, { recursive: true });
// No application payload: all installation entry points are disabled.
writeFileSync(join(payload, "Preview.exe"), "UI preview placeholder; not executable.\n");
const result = spawnSync(process.execPath, [join(root, "scripts/build-qt-installer.mjs"),
  "--preview=true", `--payload=${payload}`, "--exe=Preview.exe", "--product=KataruneUiPreview",
  "--data-name=katarune-ui-preview", "--unity-product=Katarune UI Preview",
  "--stage=build/installer-preview/stage", `--output=${output}`], { stdio: "inherit" });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
console.log(`Preview only (installation disabled): ${output}`);
if (!process.argv.includes("--build-only")) {
  const preview = spawn(output, [], { detached: true, stdio: "ignore" });
  preview.on("error", (error) => { console.error(error); process.exitCode = 1; });
  preview.unref();
}
