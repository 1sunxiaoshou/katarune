import type {
  DiscoveredModel,
  JsonObject,
  ModelMetadata,
  ModelType,
  ProviderConfig,
} from "../../shared/ipc";
import {
  speechModelMetadataSchema,
  speechModelSettingsSchema,
} from "../../shared/ipc";
import type {
  ProviderDefinition,
  ProviderModelInspection,
} from "./providerDefinitions";
import type { FetchImplementation } from "./providerModelDiscovery";

export interface PersistableModelInspection {
  readonly modelType: ModelType;
  readonly suggestedDisplayName: string | null;
  readonly metadata: ModelMetadata | null;
  readonly suggestedSettings: JsonObject | null;
}

export async function inspectModelForPersistence({
  provider,
  definition,
  apiKey,
  modelId,
  modelTypeHint,
  allowInspectionFallback,
  fetchImplementation = globalThis.fetch,
  discoveredModels,
}: {
  readonly provider: ProviderConfig;
  readonly definition: Pick<ProviderDefinition, "inspectModel">;
  readonly apiKey: string | undefined;
  readonly modelId: string;
  readonly modelTypeHint: ModelType | null;
  readonly allowInspectionFallback: boolean;
  readonly fetchImplementation?: FetchImplementation;
  readonly discoveredModels?: readonly DiscoveredModel[];
}): Promise<PersistableModelInspection> {
  let inspection: ProviderModelInspection;
  try {
    inspection = await definition.inspectModel(
      { provider, apiKey, fetchImplementation, ...(discoveredModels === undefined ? {} : { discoveredModels }) },
      modelId,
    );
  } catch (error) {
    if (!allowInspectionFallback || modelTypeHint === null) throw error;
    inspection = {
      modelType: null,
      displayName: null,
      metadata: null,
      suggestedSettings: null,
    };
  }

  if (
    inspection.modelType !== null &&
    modelTypeHint !== null &&
    inspection.modelType !== modelTypeHint
  ) {
    throw new Error(
      `供应商将该模型识别为 ${inspection.modelType}，与选择的 ${modelTypeHint} 不一致。`,
    );
  }
  const modelType = inspection.modelType ?? modelTypeHint;
  if (modelType === null) {
    throw new Error("供应商无法识别模型类别，请先手动选择类别。");
  }
  return {
    modelType,
    suggestedDisplayName: inspection.displayName,
    metadata:
      modelType === "speechModel"
        ? (inspection.metadata ?? speechModelMetadataSchema.parse({
            voices: null,
          }))
        : inspection.metadata,
    suggestedSettings:
      modelType === "speechModel"
        ? (inspection.suggestedSettings ?? speechModelSettingsSchema.parse({
            defaultVoiceId: null,
          }))
        : inspection.suggestedSettings,
  };
}
