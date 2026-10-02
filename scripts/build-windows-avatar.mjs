import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rename, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
if (process.platform !== "win32") throw new Error("build:avatar requires Windows.");
const project = join(root, "unity", "KataruneAvatar");
const versionFile = await readFile(join(project, "ProjectSettings", "ProjectVersion.txt"), "utf8");
const version = versionFile.match(/^m_EditorVersion: (.+)$/m)?.[1].trim();
if (!version) throw new Error("Cannot read the project's Unity Editor version.");
const releaseRoot = join(root, "build", "release");
await mkdir(releaseRoot, { recursive: true });
const staging = await mkdtemp(join(releaseRoot, "avatar-"));
try {
  await new Promise((accept, reject) => {
    const child = spawn("unity", ["run", project, "--editor-version", version, "--timeout", "1800", "--",
      "-executeMethod", "Katarune.Avatar.Editor.AvatarBuilder.BuildWindows"], {
      cwd: root,
      env: { ...process.env, KATARUNE_AVATAR_BUILD_OUTPUT: join(staging, "KataruneAvatar.exe") },
      stdio: "inherit",
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("exit", code => code === 0 ? accept() : reject(new Error(`Unity build failed (${code}).`)));
  });
  // Only replace this script's fixed staging destination after a successful build.
  const destination = join(releaseRoot, "avatar");
  await rm(destination, { recursive: true, force: true });
  await rename(staging, destination);
  console.log(`Windows avatar ready: ${destination}`);
} finally {
  await rm(staging, { recursive: true, force: true });
}
