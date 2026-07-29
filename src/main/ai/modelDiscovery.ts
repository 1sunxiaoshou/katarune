import { createGateway } from "ai";

import {
  discoveredModelListSchema,
  type DiscoveredModel,
  type DiscoveredModelList,
  type ModelType,
  type ProviderConfig,
} from "../../shared/ipc";
import {
  discoverModelsFromCatalog,
  enrichDiscoveredModels,
} from "./liteLlmCatalog";

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
  return typeof value === "string" && value.length > 0 ? value.slice(0, maximumLength) : null;
}

function gatewayModelType(value: unknown): ModelType | null {
  switch (value) {
    case "language":
    case "realtime":
      return "languageModel";
    case "embedding":
      return "embeddingModel";
    case "image":
      return "imageModel";
    case "transcription":
      return "transcriptionModel";
    case "speech":
      return "speechModel";
    case "reranking":
      return "rerankingModel";
    case "video":
      return "videoModel";
    default:
      return null;
  }
}

function appendPath(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${path}`;
}

function recordArray(value: unknown): readonly Record<string, unknown>[] {
  if (typeof value !== "object" || value === null) return [];
  const record = value as Record<string, unknown>;
  const models = Array.isArray(record.data) ? record.data : Array.isArray(record.models) ? record.models : [];
  return models.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null);
}

function normalizeModels(
  value: unknown,
  providerType: ProviderConfig["providerType"],
): DiscoveredModel[] {
  return recordArray(value).flatMap((item): DiscoveredModel[] => {
    const googleModelId = stringField(item.baseModelId, 500) ?? stringField(item.name, 500)?.replace(/^models\//, "") ?? null;
    const id = providerType === "google" ? googleModelId : stringField(item.id, 500);
    if (id === null) return [];
    return [{
      id,
      displayName: stringField(item.displayName, 500) ?? stringField(item.display_name, 500) ?? (providerType === "google" ? stringField(item.displayName, 500) : stringField(item.name, 500)),
      modelType: null,
      typeSource: null,
    }];
  });
}

function mergeModels(groups: readonly (readonly DiscoveredModel[])[]): DiscoveredModel[] {
  const merged = new Map<string, DiscoveredModel>();
  for (const model of groups.flat()) {
    const current = merged.get(model.id);
    if (current === undefined) {
      merged.set(model.id, model);
      continue;
    }
    merged.set(model.id, {
      ...current,
      displayName: current.displayName ?? model.displayName,
    });
  }
  return [...merged.values()].sort((left, right) => left.id.localeCompare(right.id)).slice(0, 5000);
}

function requestHeaders(providerType: ProviderConfig["providerType"], apiKey: string | undefined): Headers {
  const headers = new Headers({ Accept: "application/json" });
  if (providerType === "google") {
    if (apiKey !== undefined) headers.set("x-goog-api-key", apiKey);
  } else if (providerType === "anthropic") {
    if (apiKey !== undefined) headers.set("x-api-key", apiKey);
    headers.set("anthropic-version", "2023-06-01");
  } else if (apiKey !== undefined) {
    headers.set("Authorization", `Bearer ${apiKey}`);
  }
  return headers;
}

async function fetchModels(
  url: URL,
  providerType: ProviderConfig["providerType"],
  apiKey: string | undefined,
  fetchImplementation: FetchImplementation,
): Promise<Response> {
  return fetchImplementation(url, {
    method: "GET",
    headers: requestHeaders(providerType, apiKey),
    signal: AbortSignal.timeout(15_000),
  });
}

function hardFailure(response: Response): Error {
  return new Error(`获取模型列表失败（HTTP ${response.status}）。`);
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
    let result;
    try {
      result = await gateway.getAvailableModels();
    } catch (error) {
      const statusCode = typeof error === "object" && error !== null && "statusCode" in error
        ? (error as { readonly statusCode?: unknown }).statusCode
        : null;
      if (statusCode === 401 || statusCode === 403) {
        throw new Error(`获取模型列表失败（HTTP ${statusCode}）。`);
      }
      throw new Error("Gateway 模型端点暂时不可用，无法确认当前可用模型。");
    }
    const models = result.models.map((model): DiscoveredModel => {
      const modelType = gatewayModelType(model.modelType);
      return {
        id: model.id,
        displayName: model.name,
        modelType,
        typeSource: modelType === null ? null : "gateway",
      };
    });
    return discoveredModelListSchema.parse({
      models,
      source: "provider",
      warning: null,
    });
  }

  const baseUrl = provider.baseUrl ?? DEFAULT_BASE_URLS[provider.providerType];
  if (baseUrl === null) throw new Error("此供应商需要先配置 Base URL。");
  const url = new URL(appendPath(baseUrl, "models"));
  if (provider.providerType === "google") url.searchParams.set("pageSize", "1000");
  if (provider.providerType === "anthropic") url.searchParams.set("limit", "1000");

  let response: Response;
  try {
    response = await fetchModels(url, provider.providerType, apiKey, fetchImplementation);
  } catch {
    return discoverModelsFromCatalog(provider, baseUrl, fetchImplementation, "供应商模型端点暂时不可用，已使用 LiteLLM 模型目录。");
  }

  if (response.status === 401 || response.status === 403) throw hardFailure(response);
  if ([404, 405, 501].includes(response.status) || response.status >= 500) {
    return discoverModelsFromCatalog(provider, baseUrl, fetchImplementation, `供应商模型端点返回 HTTP ${response.status}，已使用 LiteLLM 模型目录。`);
  }
  if (!response.ok) throw hardFailure(response);

  const baseModels = normalizeModels(await response.json(), provider.providerType);
  if (baseModels.length === 0) {
    return discoveredModelListSchema.parse({ models: [], source: "provider", warning: null });
  }

  const models = mergeModels([baseModels]);
  return discoveredModelListSchema.parse({
    models: await enrichDiscoveredModels(provider, models, baseUrl, fetchImplementation),
    source: "provider",
    warning: null,
  });
}
