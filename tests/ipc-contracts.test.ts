import { describe, expect, it } from "vitest";
import {
  aiRuntimeStatusSchema,
  appendThreadMessageRequestSchema,
  appInfoSchema,
  createProviderConfigRequestSchema,
  databaseStatusSchema,
  discoveredModelListSchema,
  createModelConfigRequestSchema,
  MODEL_TYPES,
  modelConfigSchema,
  PROVIDER_TYPES,
  providerConfigSchema,
  replaceProviderCredentialRequestSchema,
  threadListSchema,
  threadMessagesSchema,
} from "../src/shared/ipc";

describe("shared IPC contracts", () => {
  it("accepts valid main-process responses", () => {
    expect(
      appInfoSchema.parse({
        name: "Katarune",
        version: "0.1.0",
        platform: "win32",
        electronVersion: "43.1.1",
        nodeVersion: "24.13.1",
      }),
    ).toMatchObject({ name: "Katarune", platform: "win32" });

    expect(
      databaseStatusSchema.parse({
        ready: true,
        journalMode: "wal",
        threadCount: 1,
        validationThreadId: "p1-database-validation",
        validationThreadRestored: true,
      }),
    ).toMatchObject({ ready: true, threadCount: 1 });

    expect(
      aiRuntimeStatusSchema.parse({
        ready: true,
        configuredProviderCount: 0,
        modelCallsEnabled: false,
      }),
    ).toMatchObject({ ready: true, modelCallsEnabled: false });
  });

  it("accepts assistant-ui thread metadata and format-preserving message records", () => {
    expect(
      threadListSchema.parse({
        threads: [
          {
            remoteId: "thread-1",
            status: "regular",
            title: "新对话",
            lastMessageAt: new Date("2026-07-19T00:00:00.000Z"),
          },
        ],
      }),
    ).toMatchObject({ threads: [{ remoteId: "thread-1", status: "regular" }] });

    const storedMessage = {
      id: "message-1",
      parent_id: null,
      format: "ai-sdk/v6",
      content: {
        role: "user",
        parts: [{ type: "text", text: "你好" }],
      },
    };

    expect(
      appendThreadMessageRequestSchema.parse({
        threadId: "thread-1",
        message: storedMessage,
      }),
    ).toMatchObject({ message: { format: "ai-sdk/v6" } });
    expect(threadMessagesSchema.parse({ messages: [storedMessage] })).toMatchObject({
      messages: [{ id: "message-1", parent_id: null }],
    });
  });

  it("accepts non-secret Provider factory configuration", () => {
    const request = {
      displayName: "主要 OpenAI",
      providerType: "openai",
      baseUrl: null,
      settings: null,
      enabled: true,
    };

    expect(createProviderConfigRequestSchema.parse(request)).toEqual(request);
    expect(
      providerConfigSchema.parse({
        id: "d3867f4b-e85f-4ff4-ac2b-974dc39ad832",
        ...request,
        credentialRef: "safe-storage/12345678-1234-4123-8123-123456789abc",
        createdAt: new Date("2026-07-19T00:00:00.000Z"),
        updatedAt: new Date("2026-07-19T00:00:00.000Z"),
      }),
    ).toMatchObject({ providerType: "openai" });
  });

  it.each(PROVIDER_TYPES)("accepts the supported AI SDK Provider type %s", (providerType) => {
    expect(
      createProviderConfigRequestSchema.parse({
        displayName: providerType,
        providerType,
        baseUrl: null,
        settings: null,
        enabled: true,
      }).providerType,
    ).toBe(providerType);
  });

  it("accepts a write-only Provider credential request", () => {
    const request = {
      providerConfigId: "d3867f4b-e85f-4ff4-ac2b-974dc39ad832",
      secret: "test-secret-that-is-never-returned",
    };
    expect(replaceProviderCredentialRequestSchema.parse(request)).toEqual(request);
  });

  it("accepts an AI SDK-aligned model configuration", () => {
    const request = {
      providerConfigId: "d3867f4b-e85f-4ff4-ac2b-974dc39ad832",
      modelType: "languageModel",
      modelId: "vendor/model-name",
      displayName: "主要模型",
      settings: {
        maxOutputTokens: 2048,
        temperature: 0.7,
        topP: 0.9,
        stopSequences: ["END"],
      },
      enabled: true,
    };

    expect(createModelConfigRequestSchema.parse(request)).toEqual(request);
    expect(
      modelConfigSchema.parse({
        id: "e76076e7-73a8-42c2-92d7-f9fa8d44f5eb",
        ...request,
        createdAt: new Date("2026-07-19T00:00:00.000Z"),
        updatedAt: new Date("2026-07-19T00:00:00.000Z"),
      }),
    ).toMatchObject({ modelType: "languageModel", modelId: "vendor/model-name", enabled: true });
  });

  it("accepts a sanitized discovered model list", () => {
    expect(discoveredModelListSchema.parse({
      models: [{ id: "provider/model", displayName: "Model", owner: "provider", description: null, modelType: "languageModel" }],
    })).toMatchObject({ models: [{ id: "provider/model", modelType: "languageModel" }] });
  });

  it.each(MODEL_TYPES)("accepts the AI SDK Registry model type %s", (modelType) => {
    expect(
      createModelConfigRequestSchema.parse({
        providerConfigId: "d3867f4b-e85f-4ff4-ac2b-974dc39ad832",
        modelType,
        modelId: "vendor/model-name",
        displayName: null,
        settings: null,
        enabled: true,
      }).modelType,
    ).toBe(modelType);
  });

  it.each([
    ["empty app name", appInfoSchema, { name: "", version: "0.1.0", platform: "win32", electronVersion: "43.1.1", nodeVersion: "24.13.1" }],
    ["negative thread count", databaseStatusSchema, { ready: true, journalMode: "wal", threadCount: -1, validationThreadId: "thread", validationThreadRestored: false }],
    ["fractional provider count", aiRuntimeStatusSchema, { ready: true, configuredProviderCount: 0.5, modelCallsEnabled: false }],
    ["unknown property", aiRuntimeStatusSchema, { ready: true, configuredProviderCount: 0, modelCallsEnabled: false, extra: true }],
    ["unknown message field", threadMessagesSchema, { messages: [{ id: "message-1", parent_id: null, format: "ai-sdk/v6", content: {}, extra: true }] }],
    ["legacy registry ID", createProviderConfigRequestSchema, { registryId: "openai-main", displayName: "OpenAI", providerType: "openai", baseUrl: null, settings: null, enabled: true }],
    ["unsupported provider type", createProviderConfigRequestSchema, { displayName: "Custom", providerType: "arbitrary-package", baseUrl: null, settings: null, enabled: true }],
    ["non-HTTP base URL", createProviderConfigRequestSchema, { displayName: "Custom", providerType: "openai-compatible", baseUrl: "file:///secret", settings: null, enabled: true }],
    ["renderer-selected credential reference", createProviderConfigRequestSchema, { displayName: "Custom", providerType: "openai-compatible", baseUrl: "https://example.com/v1", credentialRef: "safe-storage/12345678-1234-4123-8123-123456789abc", settings: null, enabled: true }],
    ["unknown provider setting", createProviderConfigRequestSchema, { displayName: "Custom", providerType: "openai-compatible", baseUrl: null, settings: { apiKey: "must-not-be-persisted" }, enabled: true }],
    ["unsupported model type", createModelConfigRequestSchema, { providerConfigId: "d3867f4b-e85f-4ff4-ac2b-974dc39ad832", modelType: "audioModel", modelId: "model", displayName: null, settings: null, enabled: true }],
    ["unknown model setting", createModelConfigRequestSchema, { providerConfigId: "d3867f4b-e85f-4ff4-ac2b-974dc39ad832", modelType: "languageModel", modelId: "model", displayName: null, settings: { apiKey: "must-not-be-persisted" }, enabled: true }],
    ["invalid top-p", createModelConfigRequestSchema, { providerConfigId: "d3867f4b-e85f-4ff4-ac2b-974dc39ad832", modelType: "languageModel", modelId: "model", displayName: null, settings: { topP: 2 }, enabled: true }],
  ])("rejects %s", (_name, schema, value) => {
    expect(schema.safeParse(value).success).toBe(false);
  });
});
