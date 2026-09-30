import type { DiscoveredModelList, ProviderConfig } from "../../shared/ipc";
import type { DatabaseRuntime } from "../database/database";
import { inspectModelForPersistence } from "./modelInspection";
import { getProviderDefinition } from "./providerDefinitions";

// Only the provider's inventory can be imported automatically. A public catalog
// fallback does not establish which models this account can actually access.
export async function importDiscoveredModels(
  database: Pick<DatabaseRuntime, "listModelConfigs" | "createModelConfig">,
  provider: ProviderConfig,
  apiKey: string | undefined,
  discovery: DiscoveredModelList,
): Promise<DiscoveredModelList> {
  if (discovery.source !== "provider") return discovery;
  const existing = new Set(database.listModelConfigs().modelConfigs
    .filter((model) => model.providerConfigId === provider.id)
    .map((model) => model.modelId));
  let failed = 0;
  for (const model of discovery.models) {
    if (model.modelType === null || existing.has(model.id)) continue;
    try {
      const inspected = await inspectModelForPersistence({
        provider,
        definition: getProviderDefinition(provider.providerType),
        apiKey,
        modelId: model.id,
        modelTypeHint: model.modelType,
        allowInspectionFallback: true,
        discoveredModels: discovery.models,
      });
      database.createModelConfig({
        providerConfigId: provider.id,
        modelId: model.id,
        modelType: inspected.modelType,
        displayName: model.displayName ?? inspected.suggestedDisplayName,
        metadata: inspected.metadata,
        settings: inspected.suggestedSettings,
        enabled: true,
      });
      existing.add(model.id);
    } catch {
      failed += 1;
    }
  }
  return failed === 0 ? discovery : {
    ...discovery,
    warning: [discovery.warning, `${failed} 个模型未能自动添加，可重试或手动添加。`].filter(Boolean).join(" ").slice(0, 1000),
  };
}
