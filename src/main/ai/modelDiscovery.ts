import { createGateway } from "ai";

import {
  discoveredModelListSchema,
  type DiscoveredModel,
  type DiscoveredModelList,
  type ModelType,
  type ProviderConfig,
} from "../../shared/ipc";

type FetchImplementation = typeof globalThis.fetch;

const DEFAULT_BASE_URLS = {
  "openai-compatible": null,
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  google: "https://generativelanguage.googleapis.com/v1beta",
  deepseek: "https://api.deepseek.com",
  xai: "https://api.x.ai/v1",
  moonshotai: "https://api.moonshot.ai/v1",
  alibaba: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
} as const;

function stringField(value: unknown, maximumLength: number): string | null {
  return typeof value === "string" && value.length > 0
    ? value.slice(0, maximumLength)
    : null;
}

function modelType(value: unknown): ModelType | null {
  switch (value) {
    case "language": return "languageModel";
    case "realtime": return "languageModel";
    case "embedding": return "embeddingModel";
    case "image": return "imageModel";
    case "speech": return "speechModel";
    case "transcription": return "transcriptionModel";
    case "video": return "videoModel";
    case "reranking": return "rerankingModel";
    default: return null;
  }
}

function appendModelsPath(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/models`;
}

function recordArray(value: unknown): readonly Record<string, unknown>[] {
  if (typeof value !== "object" || value === null) return [];
  const record = value as Record<string, unknown>;
  const models = Array.isArray(record.data) ? record.data : Array.isArray(record.models) ? record.models : [];
  return models.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null);
}

function normalizeModels(value: unknown, providerType: ProviderConfig["providerType"]): DiscoveredModelList {
  const models = recordArray(value).flatMap((item): DiscoveredModel[] => {
    const googleModelId = stringField(item.baseModelId, 500) ?? stringField(item.name, 500)?.replace(/^models\//, "") ?? null;
    const id = providerType === "google" ? googleModelId : stringField(item.id, 500);
    if (id === null) return [];

    const supportedMethods = Array.isArray(item.supportedGenerationMethods)
      ? item.supportedGenerationMethods
      : Array.isArray(item.supportedActions) ? item.supportedActions : [];
    const inferredType = providerType === "google"
      ? supportedMethods.includes("generateContent")
        ? "languageModel"
        : supportedMethods.includes("embedContent") ? "embeddingModel" : null
      : modelType(item.type);

    return [{
      id,
      displayName: stringField(item.displayName, 500) ?? stringField(item.display_name, 500) ?? stringField(item.name, 500),
      owner: stringField(item.owned_by, 200) ?? stringField(item.provider, 200),
      description: stringField(item.description, 4000),
      modelType: inferredType,
    }];
  });

  const uniqueModels = [...new Map(models.map((model) => [model.id, model])).values()]
    .sort((left, right) => left.id.localeCompare(right.id))
    .slice(0, 5000);
  return discoveredModelListSchema.parse({ models: uniqueModels });
}

export async function discoverProviderModels(
  provider: ProviderConfig,
  apiKey: string | undefined,
  fetchImplementation: FetchImplementation = globalThis.fetch,
): Promise<DiscoveredModelList> {
  if (provider.providerType === "gateway") {
    const gateway = createGateway({
      ...(apiKey === undefined ? {} : { apiKey }),
      ...(provider.baseUrl === null ? {} : { baseURL: provider.baseUrl }),
      fetch: fetchImplementation,
    });
    const result = await gateway.getAvailableModels();
    return discoveredModelListSchema.parse({
      models: result.models.map((model) => ({
        id: model.id,
        displayName: model.name,
        owner: model.specification.provider,
        description: model.description ?? null,
        modelType: modelType(model.modelType),
      })),
    });
  }

  const baseUrl = provider.baseUrl ?? DEFAULT_BASE_URLS[provider.providerType];
  if (baseUrl === null) throw new Error("此供应商需要先配置 Base URL。");

  const url = new URL(appendModelsPath(baseUrl));
  const headers = new Headers({ Accept: "application/json" });
  if (provider.providerType === "google") {
    url.searchParams.set("pageSize", "1000");
    if (apiKey !== undefined) headers.set("x-goog-api-key", apiKey);
  } else if (provider.providerType === "anthropic") {
    url.searchParams.set("limit", "1000");
    if (apiKey !== undefined) headers.set("x-api-key", apiKey);
    headers.set("anthropic-version", "2023-06-01");
  } else if (apiKey !== undefined) {
    headers.set("Authorization", `Bearer ${apiKey}`);
  }

  const response = await fetchImplementation(url, {
    method: "GET",
    headers,
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`获取模型列表失败（HTTP ${response.status}）。`);
  return normalizeModels(await response.json(), provider.providerType);
}
