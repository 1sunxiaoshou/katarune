import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdtemp, rm, rmdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NsisUpdater } from "electron-updater";
import { describe, expect, it, vi } from "vitest";
import { AppUpdateService } from "../src/main/updates/appUpdateService";
import { appUpdateStateSchema, type AppUpdateState } from "../src/shared/appUpdates";

const bytes = "isolated update fixture";
const sha512 = createHash("sha512").update(bytes).digest("base64");
const url = "Katarune-Setup-0.2.0.exe";

function fixture() {
  const updateInfo = {
    version: "0.2.0", tag: "v0.2.0", releaseDate: "2026-11-06", path: url, sha512,
    files: [{ url, size: bytes.length, sha512 }],
  };
  const engine = Object.assign(new EventEmitter(), {
    checkForUpdates: vi.fn<NsisUpdater["checkForUpdates"]>().mockResolvedValue({
      isUpdateAvailable: true, updateInfo, versionInfo: updateInfo,
    }),
    downloadUpdate: vi.fn<NsisUpdater["downloadUpdate"]>(),
    install: vi.fn<NsisUpdater["install"]>().mockReturnValue(true),
  });
  const states: AppUpdateState[] = [];
  const quit = vi.fn();
  const report = vi.fn();
  const service = new AppUpdateService(engine, state => states.push(appUpdateStateSchema.parse(state)), report, quit);
  return { engine, service, states, quit, report, updateInfo };
}

describe("Windows app updates", () => {
  it("checks automatically only on the first open, even after a failed check", async () => {
    const { service, engine } = fixture();
    engine.checkForUpdates.mockRejectedValueOnce(new Error("fixture check failure"));
    expect(engine.checkForUpdates).not.toHaveBeenCalled();
    expect(service.open()).toEqual({ status: "checking" });
    expect(service.open()).toEqual({ status: "checking" });
    await vi.waitFor(() => expect(service.getState()).toEqual({ status: "check-failed" }));
    expect(service.open()).toEqual({ status: "check-failed" });
    expect(engine.checkForUpdates).toHaveBeenCalledTimes(1);
    await service.check();
    expect(service.getState()).toEqual({ status: "available", version: "0.2.0" });
    expect(engine.checkForUpdates).toHaveBeenCalledTimes(2);
    expect(fixture().service.open()).toEqual({ status: "checking" });
  });

  it("coalesces concurrent checks and refuses non-release assets", async () => {
    const { service, engine, updateInfo } = fixture();
    updateInfo.files = [{ url: "https://invalid.example/setup.exe", size: bytes.length, sha512 }];
    await Promise.all([service.check(), service.check()]);
    await service.apply();
    expect(engine.checkForUpdates).toHaveBeenCalledTimes(1);
    expect(engine.downloadUpdate).not.toHaveBeenCalled();
    expect(service.getState()).toEqual({ status: "check-failed" });
  });

  it("downloads and requests quit from one explicit action after verification", async () => {
    const { service, engine, states, quit } = fixture();
    const directory = await mkdtemp(join(tmpdir(), "katarune-update-"));
    const installer = join(directory, "fixture.exe");
    try {
      engine.downloadUpdate
        .mockRejectedValueOnce(new Error("fixture download failure"))
        .mockImplementationOnce(async () => {
          await writeFile(installer, "corrupted fixture");
          return [installer];
        })
        .mockImplementation(async () => {
          engine.emit("download-progress", { percent: 70.8 });
          await writeFile(installer, bytes);
          return [installer];
        });
      await service.check();
      expect(engine.downloadUpdate).not.toHaveBeenCalled();
      await service.apply();
      expect(service.getState().status).toBe("download-failed");
      await service.apply();
      expect(quit).not.toHaveBeenCalled();
      expect(service.getState().status).toBe("download-failed");
      service.installOnQuit();
      expect(engine.install).not.toHaveBeenCalled();

      await Promise.all([service.apply(), service.apply()]);
      expect(engine.downloadUpdate).toHaveBeenCalledTimes(3);
      expect(states).toContainEqual({ status: "downloading", version: "0.2.0", percent: 70 });
      expect(quit).toHaveBeenCalledTimes(1);
      expect(engine.install).not.toHaveBeenCalled();
      service.installOnQuit();
      expect(engine.install).toHaveBeenCalledExactlyOnceWith(false, true);
    } finally {
      await rm(installer, { force: true });
      await rmdir(directory);
    }
  });
});
