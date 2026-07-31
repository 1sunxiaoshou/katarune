import type {
  ModelType,
  ProviderConfig,
  SpeechModelMetadata,
} from "../../shared/ipc";
import { speechModelMetadataSchema } from "../../shared/ipc";
import type {
  ProviderDefinition,
  ProviderModelInspection,
} from "./providerDefinitions";
import type { FetchImplementation } from "./providerModelDiscovery";

export interface PersistableModelInspection {
  readonly modelType: ModelType;
  readonly suggestedDisplayName: string | null;
  readonly speechMetadata: SpeechModelMetadata | null;
}

export function applyModelDefaultVoice(
  modelType: ModelType,
  speechMetadata: SpeechModelMetadata | null,
  defaultVoiceId: string | null | undefined,
): SpeechModelMetadata | null {
  if (defaultVoiceId === undefined) return speechMetadata;
  if (modelType !== "speechModel") {
    throw new Error("只有语音生成模型可以配置默认 Voice ID。");
  }
  return speechModelMetadataSchema.parse({
    ...(speechMetadata ?? { voices: null, defaultVoiceId: null }),
    defaultVoiceId,
  });
}

export async function inspectModelForPersistence({
  provider,
  definition,
  apiKey,
  modelId,
  modelTypeHint,
  allowInspectionFallback,
  fetchImplementation = globalThis.fetch,
}: {
  readonly provider: ProviderConfig;
  readonly definition: Pick<ProviderDefinition, "inspectModel">;
  readonly apiKey: string | undefined;
  readonly modelId: string;
  readonly modelTypeHint: ModelType | null;
  readonly allowInspectionFallback: boolean;
  readonly fetchImplementation?: FetchImplementation;
}): Promise<PersistableModelInspection> {
  let inspection: ProviderModelInspection;
  try {
    inspection = await definition.inspectModel(
      { provider, apiKey, fetchImplementation },
      modelId,
    );
  } catch (error) {
    if (!allowInspectionFallback || modelTypeHint === null) throw error;
    inspection = {
      modelType: null,
      displayName: null,
      speechMetadata: null,
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
    speechMetadata:
      modelType === "speechModel"
        ? (inspection.speechMetadata ?? {
            voices: null,
            defaultVoiceId: null,
          })
        : null,
  };
}
