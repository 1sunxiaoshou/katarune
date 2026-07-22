import type { KataruneApi } from "../../shared/ipc";

declare global {
  interface Window {
    readonly katarune: KataruneApi;
  }
}

export {};
