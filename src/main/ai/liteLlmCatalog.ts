import snapshotJson from "./litellm-models.json";

import {
  discoveredModelListSchema,
  type DiscoveredModel,
  type ModelType,
} from "../../shared/ipc";

type FetchImplementation = typeof globalThis.fetch;
type TypeSource = "litellm-snapshot" | "litellm-api";
type Catalog = Readonly<Record<string, Readonly<Record<string, unknown>>>>;

const ONLINE_CATALOG_URL =
  "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";

const OFFICIAL_CATALOG_IDENTITIES = [
  { baseUrl: "https://api.openai.com/v1", alias: "openai" },
  { baseUrl: "https://api.anthropic.com/v1", alias: "anthropic" },
  {
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    alias: "gemini",
  },
  { baseUrl: "https://api.deepseek.com", alias: "deepseek" },
  { baseUrl: "https://api.x.ai/v1", alias: "xai" },
  { baseUrl: "https://api.moonshot.ai/v1", alias: "moonshot" },
  {
    baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    alias: "dashscope",
  },
] as const;

const OFFICIAL_PROVIDER_URLS = new Map<string, string>(
  OFFICIAL_CATALOG_IDENTITIES.map(({ baseUrl, alias }) => [baseUrl, alias]),
);

const SNAPSHOT = snapshotJson as unknown as Catalog;
let onlineCatalogPromise: Promise<Catalog | null> | null = null;
const modelIdIndexes = new WeakMap<
  object,
  ReadonlyMap<string, readonly Readonly<Record<string, unknown>>[]>
>();

function stringValue(value: unknown, maximumLength = 200): string | null {
  return typeof value === "string" && value.length > 0 ? value.slice(0, maximumLength) : null;
}

function recordValue(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : null;
}

export function normalizeCatalogBaseUrl(value: string): string {
  const url = new URL(value);
  url.hash = "";
  url.search = "";
  url.hostname = url.hostname.toLowerCase();
  url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  return url.toString().replace(/\/$/, "");
}

function modeToModelType(value: unknown): ModelType | null {
  switch (value) {
    case "chat":
    case "completion":
    case "responses":
    case "realtime":
      return "languageModel";
    case "embedding":
      return "embeddingModel";
    case "image_generation":
    case "image_edit":
      return "imageModel";
    case "audio_speech":
      return "speechModel";
    case "audio_transcription":
      return "transcriptionModel";
    case "rerank":
      return "rerankingModel";
    case "video_generation":
      return "videoModel";
    default:
      return null;
  }
}

function endpointToModelType(value: unknown): ModelType | null {
  if (typeof value !== "string") return null;
  const normalized = value.toLowerCase();
  if (normalized.includes("embedding")) return "embeddingModel";
  if (normalized.includes("image")) return "imageModel";
  if (normalized.includes("audio/speech")) return "speechModel";
  if (normalized.includes("audio/transcription")) return "transcriptionModel";
  if (normalized.includes("rerank")) return "rerankingModel";
  if (normalized.includes("video")) return "videoModel";
  if (normalized.includes("chat/completions") || normalized.includes("responses") || normalized.includes("completions")) return "languageModel";
  return null;
}

function catalogModelTypes(entry: Readonly<Record<string, unknown>>): ModelType[] {
  const endpoints = Array.isArray(entry.supported_endpoints) ? entry.supported_endpoints : [];
  const types = endpoints.flatMap((endpoint): ModelType[] => {
    const type = endpointToModelType(endpoint);
    return type === null ? [] : [type];
  });
  const mode = modeToModelType(entry.mode);
  if (mode !== null) types.push(mode);
  return [...new Set(types)];
}

function resolveModelType(types: readonly ModelType[]): ModelType | null {
  const uniqueTypes = [...new Set(types)];
  return uniqueTypes.length === 1 ? uniqueTypes[0] ?? null : null;
}

function providerAliasFromUrl(baseUrl: string): string | null {
  return OFFICIAL_PROVIDER_URLS.get(normalizeCatalogBaseUrl(baseUrl)) ?? null;
}

export interface LiteLlmCatalogContext {
  readonly aliases: readonly string[];
  readonly inventoryAlias: string | null;
  readonly allowsInventoryFallback: boolean;
}

export function createLiteLlmCatalogContext({
  presetAlias,
  effectiveBaseUrl,
  isCustomBaseUrl,
}: {
  readonly presetAlias: string | null;
  readonly effectiveBaseUrl: string;
  readonly isCustomBaseUrl: boolean;
}): LiteLlmCatalogContext {
  const baseUrlAlias = isCustomBaseUrl
    ? providerAliasFromUrl(effectiveBaseUrl)
    : null;
  const aliases: string[] = [];
  if (baseUrlAlias !== null) aliases.push(baseUrlAlias);
  if (presetAlias !== null && !aliases.includes(presetAlias)) {
    aliases.push(presetAlias);
  }
  const inventoryAlias = isCustomBaseUrl ? baseUrlAlias : presetAlias;
  return {
    aliases,
    inventoryAlias,
    allowsInventoryFallback: inventoryAlias !== null,
  };
}

function catalogEntry(
  catalog: Catalog,
  providerAlias: string,
  modelId: string,
): Readonly<Record<string, unknown>> | null {
  const candidates = [modelId, `${providerAlias}/${modelId}`];
  for (const candidate of candidates) {
    const entry = recordValue(catalog[candidate]);
    if (entry !== null && entry.litellm_provider === providerAlias) return entry;
  }
  return null;
}

function applyCatalogType(
  model: DiscoveredModel,
  entry: Readonly<Record<string, unknown>>,
  source: TypeSource,
): DiscoveredModel | null {
  const modelType = resolveModelType(catalogModelTypes(entry));
  return modelType === null ? null : { ...model, modelType, typeSource: source };
}

function entriesForModelId(
  catalog: Catalog,
  modelId: string,
): readonly Readonly<Record<string, unknown>>[] {
  let index = modelIdIndexes.get(catalog);
  if (index === undefined) {
    const mutableIndex = new Map<string, Readonly<Record<string, unknown>>[]>();
    for (const [key, value] of Object.entries(catalog)) {
      const entry = recordValue(value);
      if (entry === null) continue;
      const entryProvider = stringValue(entry.litellm_provider, 200);
      if (entryProvider === null) continue;
      const canonicalId = canonicalModelId(key, entryProvider);
      const entries = mutableIndex.get(canonicalId) ?? [];
      entries.push(entry);
      mutableIndex.set(canonicalId, entries);
    }
    index = mutableIndex;
    modelIdIndexes.set(catalog, index);
  }
  return index.get(modelId) ?? [];
}

function applyProviderlessCatalogType(
  model: DiscoveredModel,
  entries: readonly Readonly<Record<string, unknown>>[],
  source: TypeSource,
): DiscoveredModel | null {
  const modelType = resolveModelType(entries.flatMap(catalogModelTypes));
  return modelType === null ? null : { ...model, modelType, typeSource: source };
}

function enrichFromCatalog(
  catalog: Catalog,
  identities: readonly { readonly providerAlias: string; readonly modelId: string }[],
  model: DiscoveredModel,
  source: TypeSource,
): DiscoveredModel | null {
  const modelId = identities[0]?.modelId ?? model.id;
  for (const identity of identities) {
    const exact = catalogEntry(catalog, identity.providerAlias, identity.modelId);
    if (exact !== null) {
      const enriched = applyCatalogType(model, exact, source);
      if (enriched !== null) return enriched;
    }
  }
  return applyProviderlessCatalogType(model, entriesForModelId(catalog, modelId), source);
}

async function onlineCatalog(fetchImplementation: FetchImplementation): Promise<Catalog | null> {
  onlineCatalogPromise ??= fetchImplementation(ONLINE_CATALOG_URL, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  }).then(async (response) => {
    if (!response.ok) return null;
    return recordValue(await response.json()) as Catalog | null;
  }).catch(() => null);
  return onlineCatalogPromise;
}

export async function enrichDiscoveredModels(
  models: readonly DiscoveredModel[],
  context: LiteLlmCatalogContext,
  fetchImplementation: FetchImplementation,
): Promise<readonly DiscoveredModel[]> {
  return Promise.all(models.map(async (model): Promise<DiscoveredModel> => {
    const identities = context.aliases.map((providerAlias) => ({
      providerAlias,
      modelId: model.id,
    }));
    const local = enrichFromCatalog(SNAPSHOT, identities, model, "litellm-snapshot");
    if (local !== null) return local;
    const online = await onlineCatalog(fetchImplementation);
    const remote = online === null ? null : enrichFromCatalog(online, identities, model, "litellm-api");
    return remote ?? model;
  }));
}

function canonicalModelId(key: string, providerAlias: string): string {
  const prefix = `${providerAlias}/`;
  return key.startsWith(prefix) ? key.slice(prefix.length) : key;
}

function catalogModelsForProvider(
  catalog: Catalog,
  providerAlias: string,
  source: TypeSource,
): readonly DiscoveredModel[] {
  const candidates = Object.entries(catalog).flatMap(([key, value]): DiscoveredModel[] => {
    const entry = recordValue(value);
    if (entry === null || entry.litellm_provider !== providerAlias) return [];
    const modelType = resolveModelType(catalogModelTypes(entry));
    if (modelType === null) return [];
    const id = canonicalModelId(key, providerAlias);
    return [{
      id,
      displayName: null,
      modelType,
      typeSource: source,
    }];
  });
  return [...new Map(candidates.map((model) => [model.id, model])).values()]
    .sort((left, right) => left.id.localeCompare(right.id))
    .slice(0, 5000);
}

export async function discoverModelsFromCatalog(
  context: LiteLlmCatalogContext,
  fetchImplementation: FetchImplementation,
  warning: string,
) {
  if (!context.allowsInventoryFallback) {
    throw new Error(`${warning}自定义 Base URL 的实际可用模型不能由供应商完整目录代替。`);
  }
  const alias = context.inventoryAlias;
  if (alias === null) {
    throw new Error(`${warning}且无法匹配 LiteLLM 模型目录。`);
  }
  const local = catalogModelsForProvider(SNAPSHOT, alias, "litellm-snapshot");
  if (local.length > 0) {
    return discoveredModelListSchema.parse({ models: local, source: "litellm-snapshot", warning });
  }
  const online = await onlineCatalog(fetchImplementation);
  const remote = online === null ? [] : catalogModelsForProvider(online, alias, "litellm-api");
  if (remote.length > 0) {
    return discoveredModelListSchema.parse({ models: remote, source: "litellm-api", warning });
  }
  throw new Error(`${warning}且 LiteLLM 模型目录中没有对应供应商。`);
}
