import type {
  ModelConfig,
  ProviderConfig,
} from "../../../shared/ipc";

export type SettingsDataState =
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly message: string }
  | {
      readonly status: "ready";
      readonly providers: readonly ProviderConfig[];
      readonly models: readonly ModelConfig[];
    };

export function errorMessage(
  error: unknown,
  fallback: string,
): string {
  return error instanceof Error ? error.message : fallback;
}
