import * as z from "zod/mini";

export const APP_UPDATE_CHANNELS = {
  open: "app-update:open",
  changed: "app-update:changed",
  check: "app-update:check",
  apply: "app-update:apply",
} as const;

export const KATARUNE_GITHUB_REPOSITORY = { owner: "1sunxiaoshou", repo: "katarune" } as const;
export const KATARUNE_PROJECT_URL = `https://github.com/${KATARUNE_GITHUB_REPOSITORY.owner}/${KATARUNE_GITHUB_REPOSITORY.repo}`;

export const appReleaseVersionSchema = z.string().check(z.regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/), z.maxLength(64));

export const appUpdateStateSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.enum(["unavailable", "idle", "checking", "latest", "check-failed"]) }),
  z.strictObject({ status: z.enum(["available", "download-failed", "installing"]), version: appReleaseVersionSchema }),
  z.strictObject({ status: z.literal("downloading"), version: appReleaseVersionSchema, percent: z.nullable(z.int().check(z.minimum(0), z.maximum(99))) }),
]);

export type AppUpdateState = z.infer<typeof appUpdateStateSchema>;

export interface AppUpdatesApi {
  openAppUpdatePage(): Promise<AppUpdateState>;
  checkAppUpdate(): Promise<void>;
  applyAppUpdate(): Promise<void>;
  onAppUpdateChanged(listener: (state: AppUpdateState) => void): () => void;
}
