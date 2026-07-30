import type { ProviderConfig } from "../../shared/ipc";
import {
  getProviderDefinition,
  type RegistryProvider,
} from "./providerDefinitions";

export type { RegistryProvider } from "./providerDefinitions";

export function createConfiguredProvider(
  config: ProviderConfig,
  apiKey: string | undefined,
): RegistryProvider {
  return getProviderDefinition(config.providerType).createProvider(config, apiKey);
}
