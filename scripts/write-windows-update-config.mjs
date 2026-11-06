import { writeFile } from "node:fs/promises";
import { join } from "node:path";

export default async function writeWindowsUpdateConfig({ electronPlatformName, appOutDir, packager }) {
  if (electronPlatformName !== "win32") return;
  // The two-stage Windows build packs a dir first. Builder only writes the
  // update feed automatically when NSIS is a target of that packing step.
  const publish = packager.platformSpecificBuildOptions.publish;
  if (publish?.provider !== "github" || !publish.owner || !publish.repo) {
    throw new Error("Windows builds require a GitHub Releases update source.");
  }
  const config = {
    provider: publish.provider,
    owner: publish.owner,
    repo: publish.repo,
    updaterCacheDirName: packager.appInfo.updaterCacheDirName,
  };
  await writeFile(join(packager.getResourcesDir(appOutDir), "app-update.yml"), JSON.stringify(config, null, 2) + "\n");
}
