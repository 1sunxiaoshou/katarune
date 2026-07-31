import {
  discoveredModelListSchema,
  type DiscoveredModelList,
  type ProviderConfig,
} from "../../shared/ipc";
import {
  getProviderDefinition,
  type ProviderDefinitionRegistry,
  PROVIDER_DEFINITIONS,
} from "./providerDefinitions";
import type { FetchImplementation } from "./providerModelDiscovery";

export async function discoverProviderModels(
  provider: ProviderConfig,
  apiKey: string | undefined,
  fetchImplementation: FetchImplementation = globalThis.fetch,
  definitions: ProviderDefinitionRegistry = PROVIDER_DEFINITIONS,
): Promise<DiscoveredModelList> {
  const definition = getProviderDefinition(provider.providerType, definitions);
  return discoveredModelListSchema.parse(
    await definition.discoverModels({
      provider,
      apiKey,
      fetchImplementation,
    }),
  );
}
