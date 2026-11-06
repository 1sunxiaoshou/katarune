import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { app } from "electron";
import electronUpdater from "electron-updater";
import * as z from "zod/mini";
import { KATARUNE_GITHUB_REPOSITORY } from "../../shared/appUpdates";

const installerIdentity = z.strictObject({ product: z.literal("Katarune"), engine: z.literal("nsis") });

export function createWindowsUpdater() {
  if (!app.isPackaged || process.platform !== "win32" || process.arch !== "x64") return;
  try {
    const identity: unknown = JSON.parse(readFileSync(join(dirname(process.execPath), ".installer", "identity.json"), "utf8"));
    if (!installerIdentity.safeParse(identity).success) return;
  } catch {
    return;
  }

  const updater = new electronUpdater.NsisUpdater({ provider: "github", ...KATARUNE_GITHUB_REPOSITORY });
  updater.logger = null;
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = false;
  updater.allowPrerelease = false;
  updater.allowDowngrade = false;
  updater.disableWebInstaller = true;
  return updater;
}
