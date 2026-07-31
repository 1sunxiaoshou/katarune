import { createGateway } from "ai";

import {
  discoveredModelListSchema,
  type DiscoveredModel,
  type DiscoveredModelList,
  type ModelType,
  type ProviderConfig,
} from "../../shared/ipc";
import {
  createLiteLlmCatalogContext,
  discoverModelsFromCatalog,
  enrichDiscoveredModels,
} from "./liteLlmCatalog";

export type FetchImplementation = typeof globalThis.fetch;

export interface ProviderModelDiscoveryContext {
  readonly provider: ProviderConfig;
  readonly apiKey: string | undefined;
  readonly fetchImplementation: FetchImplementation;
}

export type ProviderModelDiscovery = (
  context: ProviderModelDiscoveryContext,
) => Promise<DiscoveredModelList>;

interface HttpModelDiscoveryOptions {
  readonly defaultBaseUrl: string | null;
  readonly liteLlmCatalogAlias?: string;
  readonly configureUrl?: (url: URL) => void;
  readonly nextPageUrl?: (value: unknown, currentUrl: URL) => URL | null;
  readonly createHeaders: (apiKey: string | undefined) => Headers;
  readonly normalizeModels: (value: unknown) => readonly DiscoveredModel[];
}

function appendPath(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${path}`;
}

function hardFailure(response: Response): Error {
  return new Error(`获取模型列表失败（HTTP ${response.status}）。`);
}

export function stringField(
  value: unknown,
  maximumLength: number,
): string | null {
  return typeof value === "string" && value.length > 0
    ? value.slice(0, maximumLength)
    : null;
}

export function recordArray(
  value: unknown,
): readonly Record<string, unknown>[] {
  if (typeof value !== "object" || value === null) return [];
  const record = value as Record<string, unknown>;
  const models = Array.isArray(record.data)
    ? record.data
    : Array.isArray(record.models)
      ? record.models
      : [];
  return models.filter(
    (item): item is Record<string, unknown> =>
      typeof item === "object" && item !== null,
  );
}

export function normalizeOpenAiModels(value: unknown): readonly DiscoveredModel[] {
  return recordArray(value).flatMap((item): DiscoveredModel[] => {
    const id = stringField(item.id, 500);
    if (id === null) return [];
    return [
      {
        id,
        displayName:
          stringField(item.displayName, 500) ??
          stringField(item.display_name, 500) ??
          stringField(item.name, 500),
        modelType: null,
        typeSource: null,
      },
    ];
  });
}

export function normalizeGoogleModels(value: unknown): readonly DiscoveredModel[] {
  return recordArray(value).flatMap((item): DiscoveredModel[] => {
    const id =
      stringField(item.baseModelId, 500) ??
      stringField(item.name, 500)?.replace(/^models\//, "") ??
      null;
    if (id === null) return [];
    return [
      {
        id,
        displayName: stringField(item.displayName, 500),
        modelType: null,
        typeSource: null,
      },
    ];
  });
}

function mergeModels(
  groups: readonly (readonly DiscoveredModel[])[],
): readonly DiscoveredModel[] {
  const merged = new Map<string, DiscoveredModel>();
  for (const model of groups.flat()) {
    const current = merged.get(model.id);
    merged.set(
      model.id,
      current === undefined
        ? model
        : {
            ...current,
            displayName: current.displayName ?? model.displayName,
          },
    );
  }
  return [...merged.values()]
    .sort((left, right) => left.id.localeCompare(right.id))
    .slice(0, 5_000);
}

export function bearerHeaders(apiKey: string | undefined): Headers {
  const headers = new Headers({ Accept: "application/json" });
  if (apiKey !== undefined) headers.set("Authorization", `Bearer ${apiKey}`);
  return headers;
}

export function createHttpModelDiscovery({
  defaultBaseUrl,
  liteLlmCatalogAlias,
  configureUrl,
  nextPageUrl,
  createHeaders,
  normalizeModels,
}: HttpModelDiscoveryOptions): ProviderModelDiscovery {
  return async ({
    provider,
    apiKey,
    fetchImplementation,
  }): Promise<DiscoveredModelList> => {
    const baseUrl = provider.baseUrl ?? defaultBaseUrl;
    if (baseUrl === null) {
      throw new Error("此供应商需要先配置 Base URL。");
    }
    const catalogContext = createLiteLlmCatalogContext({
      presetAlias: liteLlmCatalogAlias ?? null,
      effectiveBaseUrl: baseUrl,
      isCustomBaseUrl: provider.baseUrl !== null,
    });
    const url = new URL(appendPath(baseUrl, "models"));
    configureUrl?.(url);
    const modelPages: (readonly DiscoveredModel[])[] = [];
    const visitedUrls = new Set<string>();
    let currentUrl: URL | null = url;
    for (let page = 0; currentUrl !== null && page < 100; page += 1) {
      const currentUrlString = currentUrl.toString();
      if (visitedUrls.has(currentUrlString)) {
        throw new Error("供应商模型分页返回了重复的下一页地址。");
      }
      visitedUrls.add(currentUrlString);

      let response: Response;
      try {
        response = await fetchImplementation(currentUrl, {
          method: "GET",
          headers: createHeaders(apiKey),
          signal: AbortSignal.timeout(15_000),
        });
      } catch {
        return discoverModelsFromCatalog(
          catalogContext,
          fetchImplementation,
          "供应商模型端点暂时不可用，已使用 LiteLLM 模型目录。",
        );
      }

      if (response.status === 401 || response.status === 403) {
        throw hardFailure(response);
      }
      if (
        [404, 405, 501].includes(response.status) ||
        response.status >= 500
      ) {
        return discoverModelsFromCatalog(
          catalogContext,
          fetchImplementation,
          `供应商模型端点返回 HTTP ${response.status}，已使用 LiteLLM 模型目录。`,
        );
      }
      if (!response.ok) throw hardFailure(response);

      const value: unknown = await response.json();
      modelPages.push(normalizeModels(value));
      currentUrl = nextPageUrl?.(value, currentUrl) ?? null;
    }
    if (currentUrl !== null) {
      throw new Error("供应商模型列表超过 100 页，已停止继续读取。");
    }

    const baseModels = mergeModels(modelPages);
    if (baseModels.length === 0) {
      return discoveredModelListSchema.parse({
        models: [],
        source: "provider",
        warning: null,
      });
    }
    return discoveredModelListSchema.parse({
      models: await enrichDiscoveredModels(
        baseModels,
        catalogContext,
        fetchImplementation,
      ),
      source: "provider",
      warning: null,
    });
  };
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

export const discoverGatewayModels: ProviderModelDiscovery = async ({
  provider,
  apiKey,
  fetchImplementation,
}) => {
  const gateway = createGateway({
    ...(apiKey === undefined ? {} : { apiKey }),
    ...(provider.baseUrl === null ? {} : { baseURL: provider.baseUrl }),
    fetch: fetchImplementation,
  });
  let result;
  try {
    result = await gateway.getAvailableModels();
  } catch (error) {
    const statusCode =
      typeof error === "object" && error !== null && "statusCode" in error
        ? (error as { readonly statusCode?: unknown }).statusCode
        : null;
    if (statusCode === 401 || statusCode === 403) {
      throw new Error(`获取模型列表失败（HTTP ${statusCode}）。`);
    }
    throw new Error("Gateway 模型端点暂时不可用，无法确认当前可用模型。");
  }
  return discoveredModelListSchema.parse({
    models: result.models.map((model): DiscoveredModel => {
      const modelType = gatewayModelType(model.modelType);
      return {
        id: model.id,
        displayName: model.name,
        modelType,
        typeSource: modelType === null ? null : "gateway",
      };
    }),
    source: "provider",
    warning: null,
  });
};
