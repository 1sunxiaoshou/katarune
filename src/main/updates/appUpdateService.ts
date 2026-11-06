import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import type { NsisUpdater } from "electron-updater";
import * as z from "zod/mini";
import { appReleaseVersionSchema, type AppUpdateState } from "../../shared/appUpdates";

// Only the official versioned offline installer is allowed. Release metadata
// never supplies a renderer-visible URL, a web package or an elevation request.
const releaseSchema = z.object({
  version: appReleaseVersionSchema,
  tag: z.string(),
  isAdminRightsRequired: z.optional(z.literal(false)),
  packages: z.optional(z.null()),
  files: z.tuple([z.object({
    url: z.string(),
    sha512: z.string().check(z.regex(/^[A-Za-z0-9+/]{85}[AQgw]==$/)),
    size: z.int().check(z.positive()),
    isAdminRightsRequired: z.optional(z.literal(false)),
  })]),
});

type UpdateEngine = Pick<NsisUpdater, "checkForUpdates" | "downloadUpdate" | "install"> & {
  on(event: "error", listener: (error: Error) => void): void;
  on(event: "download-progress", listener: (progress: { percent: number }) => void): void;
};
type Operation = "check" | "download" | "install";

export class AppUpdateService {
  private state: AppUpdateState;
  private release: z.infer<typeof releaseSchema> | undefined;
  private opened = false;
  private installPending = false;

  constructor(
    private readonly engine: UpdateEngine | undefined,
    private readonly publish: (state: AppUpdateState) => void,
    private readonly report: (operation: Operation, error: unknown) => void,
    private readonly quit: () => void,
  ) {
    this.state = { status: engine ? "idle" : "unavailable" };
    engine?.on("error", (error) => {
      // Promise rejections handle check/download. Installation also emits
      // errors when the detached installer cannot start.
      if (this.state.status === "installing" && this.installPending) this.report("install", error);
    });
    engine?.on("download-progress", ({ percent }) => {
      const state = this.state;
      if (state.status !== "downloading" || !Number.isFinite(percent)) return;
      const next = Math.max(0, Math.min(99, Math.floor(percent)));
      if (next !== state.percent) this.set({ ...state, percent: next });
    });
  }

  getState(): AppUpdateState {
    return this.state;
  }

  open(): AppUpdateState {
    if (!this.opened) {
      this.opened = true;
      void this.check();
    }
    return this.state;
  }

  async check(): Promise<void> {
    if (!this.engine || !["idle", "latest", "check-failed"].includes(this.state.status)) return;
    this.set({ status: "checking" });
    try {
      const result = await this.engine.checkForUpdates();
      if (!result) throw new Error("Update check did not run.");
      if (!result.isUpdateAvailable) {
        this.set({ status: "latest" });
        return;
      }
      const release = releaseSchema.parse(result.updateInfo);
      if (release.tag !== `v${release.version}` || release.files[0].url !== `Katarune-Setup-${release.version}.exe`) {
        throw new Error("Unexpected Windows release tag or installer name.");
      }
      this.release = release;
      this.set({ status: "available", version: release.version });
    } catch (error) {
      this.report("check", error);
      this.set({ status: "check-failed" });
    }
  }

  async apply(): Promise<void> {
    const { state, release, engine } = this;
    if (!engine || !release || (state.status !== "available" && state.status !== "download-failed")) return;
    this.set({ status: "downloading", version: state.version, percent: null });
    let operation: Operation = "download";
    try {
      const [installer] = await engine.downloadUpdate();
      if (!installer) throw new Error("Update installer is missing.");
      operation = "install";
      this.set({ status: "installing", version: state.version });
      // Verify the staged installer before committing to quit, including when
      // electron-updater reuses a cached download.
      const hash = createHash("sha512");
      for await (const chunk of createReadStream(installer)) hash.update(chunk);
      if (hash.digest("base64") !== release.files[0].sha512) throw new Error("Update installer checksum mismatch.");
    } catch (error) {
      this.report(operation, error);
      this.set({ status: "download-failed", version: state.version });
      return;
    }
    this.installPending = true;
    this.quit();
  }

  installOnQuit(): void {
    if (!this.installPending) return;
    this.engine?.install(false, true);
  }

  private set(state: AppUpdateState): void {
    this.state = state;
    this.publish(state);
  }
}
