import { afterEach, describe, expect, it, vi } from "vitest";
import { importDiscoveredModels } from "../src/main/ai/importDiscoveredModels";
import { discoverProviderModelsRequestSchema, type DiscoveredModelList, type ModelConfig, type ProviderConfig } from "../src/shared/ipc";
import type { DatabaseRuntime } from "../src/main/database/database";

const provider: ProviderConfig = {
  id: "d3867f4b-e85f-4ff4-ac2b-974dc39ad832", displayName: "OpenAI", providerType: "openai",
  baseUrl: null, credentialRef: null, settings: null, enabled: true, createdAt: new Date(), updatedAt: new Date(),
};
const discovery: DiscoveredModelList = { source: "provider", warning: null, models: [
  { id: "chat-one", displayName: null, modelType: "languageModel", typeSource: "litellm-snapshot" },
  { id: "unknown-one", displayName: null, modelType: null, typeSource: null },
  { id: "tts-1", displayName: null, modelType: "speechModel", typeSource: "litellm-snapshot" },
] };
function repository() {
  const models: ModelConfig[] = [];
  const database: Pick<DatabaseRuntime, "listModelConfigs" | "createModelConfig"> = {
    listModelConfigs: () => ({ modelConfigs: models }),
    createModelConfig: vi.fn((request) => {
      const model = { ...request, id: `saved-${models.length}`, modelType: request.modelType!, metadata: request.metadata ?? null, createdAt: new Date(), updatedAt: new Date() };
      models.push(model);
      return model;
    }),
  };
  return { database, models };
}
afterEach(() => vi.unstubAllGlobals());

describe("automatic model import", () => {
  it("imports known categories without repeated discovery, preserves unknowns, and retains speech defaults", async () => {
    const fetch = vi.fn(() => { throw new Error("Unexpected network request"); });
    vi.stubGlobal("fetch", fetch);
    const { database, models } = repository();
    const result = await importDiscoveredModels(database, provider, undefined, discovery);
    expect(models.map((model) => model.modelId)).toEqual(["chat-one", "tts-1"]);
    expect(models[1]?.metadata).toHaveProperty("voices");
    expect(result.models[1]?.modelType).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("retries without duplicating or overwriting existing settings", async () => {
    const { database, models } = repository();
    await importDiscoveredModels(database, provider, undefined, discovery);
    models[0] = { ...models[0]!, displayName: "My name", enabled: false };
    await importDiscoveredModels(database, provider, undefined, discovery);
    expect(models).toHaveLength(2);
    expect(models[0]).toMatchObject({ displayName: "My name", enabled: false });
  });
  it("does not automatically import public catalog fallback inventories", async () => {
    const { database, models } = repository();
    await importDiscoveredModels(database, provider, undefined, { ...discovery, source: "litellm-snapshot" });
    expect(models).toHaveLength(0);
  });
  it("continues after one persistence failure and reports a retryable warning", async () => {
    const { database, models } = repository();
    vi.mocked(database.createModelConfig).mockImplementationOnce(() => { throw new Error("write failed"); });
    const result = await importDiscoveredModels(database, provider, undefined, discovery);
    expect(models.map((model) => model.modelId)).toEqual(["tts-1"]);
    expect(result.warning).toContain("1 个模型未能自动添加");
    expect(result.models).toEqual(discovery.models);
  });
  it("validates the automatic import request at the IPC boundary", () => {
    expect(discoverProviderModelsRequestSchema.parse({ id: provider.id, autoAdd: true }).autoAdd).toBe(true);
    expect(discoverProviderModelsRequestSchema.safeParse({ id: provider.id, autoAdd: "true" }).success).toBe(false);
    expect(discoverProviderModelsRequestSchema.safeParse({ id: "invalid", autoAdd: true }).success).toBe(false);
    expect(discoverProviderModelsRequestSchema.safeParse({ id: provider.id, models: [] }).success).toBe(false);
  });
});
