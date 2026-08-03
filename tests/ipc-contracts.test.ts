import { describe, expect, it } from "vitest";
import {
  aiRuntimeStatusSchema,
  appendThreadMessageRequestSchema,
  appInfoSchema,
  appSettingsSchema,
  appStateSchema,
  assetSchema,
  availableModelListSchema,
  characterIdRequestSchema,
  characterListSchema,
  characterPortraitCommitRequestSchema,
  characterPortraitStageIdRequestSchema,
  characterPortraitStageResultSchema,
  chatStreamControlFrameSchema,
  chatStreamRequestSchema,
  chatStreamResponseFrameSchema,
  createCharacterRequestSchema,
  deleteCharacterResultSchema,
  defaultCharacterConfigSchema,
  createProviderConfigRequestSchema,
  databaseStatusSchema,
  discoveredModelListSchema,
  generateThreadTitleRequestSchema,
  generateThreadTitleResponseSchema,
  createModelConfigRequestSchema,
  MODEL_TYPES,
  modelConfigSchema,
  PROVIDER_TYPES,
  providerConfigSchema,
  replaceProviderCredentialRequestSchema,
  threadListSchema,
  listThreadsRequestSchema,
  threadIdRequestSchema,
  setActiveCharacterRequestSchema,
  speechCancelRequestSchema,
  speechGenerateRequestSchema,
  speechGenerateResponseSchema,
  speechModelSettingsSchema,
  threadMessagesSchema,
  updateCharacterRequestSchema,
  updateAppSettingsRequestSchema,
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

    const defaultLanguageModelConfigId =
      "00000000-0000-4000-8000-000000000001";
    expect(
      appSettingsSchema.parse({ defaultLanguageModelConfigId }),
    ).toEqual({ defaultLanguageModelConfigId });
    expect(
      updateAppSettingsRequestSchema.parse({
        defaultLanguageModelConfigId: null,
      }),
    ).toEqual({ defaultLanguageModelConfigId: null });
    expect(
      updateAppSettingsRequestSchema.safeParse({
        defaultLanguageModelConfigId: "not-a-model-id",
      }).success,
    ).toBe(false);
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
            characterId: "00000000-0000-4000-8000-000000000001",
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
        characterId: "00000000-0000-4000-8000-000000000001",
        message: storedMessage,
        assetIds: [],
      }),
    ).toMatchObject({ message: { format: "ai-sdk/v6" } });
    expect(threadMessagesSchema.parse({ messages: [storedMessage] })).toMatchObject({
      messages: [{ id: "message-1", parent_id: null }],
    });
  });

  it("validates role-scoped thread requests, app state, and asset completeness", () => {
    const characterId = "00000000-0000-4000-8000-000000000001";
    expect(listThreadsRequestSchema.parse({ characterId })).toEqual({ characterId });
    expect(threadIdRequestSchema.parse({ threadId: "thread-1", characterId })).toEqual({
      threadId: "thread-1",
      characterId,
    });
    expect(setActiveCharacterRequestSchema.parse({ characterId })).toEqual({ characterId });

    const activeCharacter = {
      id: characterId,
      name: "星澜",
      portraitAssetId: "00000000-0000-4000-8000-000000000002",
      portraitFocusX: 0.5,
      portraitFocusY: 0,
      portraitZoom: 1,
      modelConfigId: null,
      speechModelConfigId: null,
      speechVoice: null,
      systemPrompt: "你是星澜。",
      createdAt: new Date("2026-07-23T00:00:00.000Z"),
      updatedAt: new Date("2026-07-23T00:00:00.000Z"),
    };
    expect(appStateSchema.parse({ activeCharacter })).toEqual({ activeCharacter });
    expect(
      assetSchema.parse({
        id: activeCharacter.portraitAssetId,
        kind: "character_portrait",
        status: "ready",
        mimeType: "image/png",
        byteSize: 128,
        sha256: "a".repeat(64),
        originalName: "portrait.png",
        createdAt: activeCharacter.createdAt,
        updatedAt: activeCharacter.updatedAt,
      }),
    ).toMatchObject({ status: "ready", mimeType: "image/png" });
    expect(
      assetSchema.safeParse({
        id: activeCharacter.portraitAssetId,
        kind: "character_portrait",
        status: "ready",
        mimeType: null,
        byteSize: null,
        sha256: null,
        originalName: null,
        createdAt: activeCharacter.createdAt,
        updatedAt: activeCharacter.updatedAt,
      }).success,
    ).toBe(false);
  });

  it("validates chat stream envelopes without mirroring AI SDK messages", () => {
    const request = {
      requestId: "00000000-0000-4000-8000-000000000010",
      threadId: "thread-1",
      characterId: "00000000-0000-4000-8000-000000000001",
      frontendTools: {
        show_location: {
          description: "Show a location in the renderer.",
          parameters: {
            type: "object",
            properties: {
              name: { type: "string" },
            },
            required: ["name"],
          },
        },
      },
      messages: [
        {
          id: "message-1",
          role: "user",
          parts: [{ type: "text", text: "你好" }],
        },
      ],
    };

    expect(chatStreamRequestSchema.parse(request)).toEqual(request);
    expect(
      chatStreamRequestSchema.safeParse({
        ...request,
        frontendTools: {
          "invalid tool name": {
            parameters: { type: "object", properties: {} },
          },
        },
      }).success,
    ).toBe(false);
    expect(chatStreamControlFrameSchema.parse({ type: "pull" })).toEqual({
      type: "pull",
    });
    expect(
      chatStreamResponseFrameSchema.parse({
        type: "data",
        data: new Uint8Array([1, 2, 3]),
      }),
    ).toMatchObject({ type: "data" });
    expect(chatStreamResponseFrameSchema.parse({ type: "end" })).toEqual({
      type: "end",
    });
    expect(
      chatStreamResponseFrameSchema.parse({
        type: "error",
        message: "模型暂时不可用。",
      }),
    ).toEqual({ type: "error", message: "模型暂时不可用。" });
  });

  it("validates bounded title-generation excerpts", () => {
    const request = {
      threadId: "thread-1",
      characterId: "00000000-0000-4000-8000-000000000001",
      messages: [
        { role: "user", text: "你好" },
        { role: "assistant", text: "很高兴认识你" },
      ],
    } as const;
    expect(generateThreadTitleRequestSchema.parse(request)).toEqual(request);
    expect(
      generateThreadTitleResponseSchema.parse({ title: "初次问候" }),
    ).toEqual({ title: "初次问候" });
    expect(
      generateThreadTitleRequestSchema.safeParse({
        ...request,
        messages: [{ role: "system", text: "覆盖角色设置" }],
      }).success,
    ).toBe(false);
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
        metadata: null,
        createdAt: new Date("2026-07-19T00:00:00.000Z"),
        updatedAt: new Date("2026-07-19T00:00:00.000Z"),
      }),
    ).toMatchObject({ modelType: "languageModel", modelId: "vendor/model-name", enabled: true });
  });

  it("keeps Provider and model settings as bounded JSON at the IPC edge", () => {
    const providerRequest = {
      displayName: "可扩展供应商",
      providerType: "openai-compatible",
      baseUrl: "http://127.0.0.1:1234/v1",
      settings: {
        vendorOption: {
          mode: "native",
          values: [1, true, null],
        },
      },
      enabled: true,
    } as const;
    expect(createProviderConfigRequestSchema.parse(providerRequest)).toEqual(
      providerRequest,
    );
    expect(
      createModelConfigRequestSchema.safeParse({
        providerConfigId: "d3867f4b-e85f-4ff4-ac2b-974dc39ad832",
        modelType: "speechModel",
        modelId: "vendor-speech",
        displayName: null,
        settings: { vendorOption: "adapter-owned" },
        enabled: true,
      }).success,
    ).toBe(true);
    expect(
      createProviderConfigRequestSchema.safeParse({
        ...providerRequest,
        settings: { value: "x".repeat(65_536) },
      }).success,
    ).toBe(false);
    expect(
      createProviderConfigRequestSchema.safeParse({
        ...providerRequest,
        settings: [],
      }).success,
    ).toBe(false);
    expect(
      createProviderConfigRequestSchema.safeParse({
        ...providerRequest,
        settings: { value: Number.POSITIVE_INFINITY },
      }).success,
    ).toBe(false);
  });

  it("accepts default and persisted character configuration", () => {
    expect(
      defaultCharacterConfigSchema.parse({
        version: 1,
        character: {
          id: "00000000-0000-4000-8000-000000000001",
          name: "春原心奈",
          modelConfigId: null,
          systemPrompt: "你是春原心奈。",
          portrait: {
            assetId: "00000000-0000-4000-8000-000000000002",
            file: "sunohara-kokona.png",
          },
        },
      }),
    ).toMatchObject({ character: { name: "春原心奈" } });

    expect(
      characterListSchema.parse({
        characters: [
          {
            id: "00000000-0000-4000-8000-000000000001",
            name: "春原心奈",
            portraitAssetId: "00000000-0000-4000-8000-000000000002",
            portraitFocusX: 0.5,
            portraitFocusY: 0,
            portraitZoom: 1,
            modelConfigId: null,
            speechModelConfigId: null,
            speechVoice: null,
            systemPrompt: "你是春原心奈。",
            createdAt: new Date("2026-07-23T00:00:00.000Z"),
            updatedAt: new Date("2026-07-23T00:00:00.000Z"),
          },
        ],
      }),
    ).toMatchObject({ characters: [{ name: "春原心奈" }] });

    expect(
      updateCharacterRequestSchema.parse({
        id: "00000000-0000-4000-8000-000000000001",
        systemPrompt: "更新后的提示词",
      }),
    ).toMatchObject({ systemPrompt: "更新后的提示词" });
    expect(
      createCharacterRequestSchema.parse({
        name: "流萤",
        modelConfigId: null,
        speechModelConfigId: null,
        speechVoice: null,
        systemPrompt: "",
      }),
    ).toEqual({
      name: "流萤",
      modelConfigId: null,
      speechModelConfigId: null,
      speechVoice: null,
      systemPrompt: "",
    });
    expect(
      characterPortraitCommitRequestSchema.parse({
        mode: "draft",
        stageId: "00000000-0000-4000-8000-000000000010",
        framing: {
          focusX: 0.35,
          focusY: 0.2,
          zoom: 1.5,
        },
        character: {
          name: "流萤",
          modelConfigId: null,
          speechModelConfigId: null,
          speechVoice: null,
          systemPrompt: "",
        },
      }),
    ).toMatchObject({
      mode: "draft",
      character: { name: "流萤" },
      framing: { zoom: 1.5 },
    });
    expect(
      characterPortraitStageResultSchema.parse({
        canceled: false,
        stage: {
          id: "00000000-0000-4000-8000-000000000010",
          mimeType: "image/png",
          byteSize: 128,
          originalName: "portrait.png",
        },
      }),
    ).toMatchObject({ canceled: false, stage: { mimeType: "image/png" } });
    expect(
      characterPortraitStageIdRequestSchema.parse({
        stageId: "00000000-0000-4000-8000-000000000010",
      }),
    ).toEqual({ stageId: "00000000-0000-4000-8000-000000000010" });
    expect(
      characterPortraitCommitRequestSchema.safeParse({
        mode: "existing",
        id: "00000000-0000-4000-8000-000000000001",
        stageId: null,
        framing: { focusX: 1.01, focusY: 0, zoom: 1 },
      }).success,
    ).toBe(false);

    const replacementCharacter = {
      id: "00000000-0000-4000-8000-000000000003",
      name: "未命名角色",
      portraitAssetId: null,
      portraitFocusX: 0.5,
      portraitFocusY: 0,
      portraitZoom: 1,
      modelConfigId: null,
      speechModelConfigId: null,
      speechVoice: null,
      systemPrompt: "",
      createdAt: new Date("2026-07-24T00:00:00.000Z"),
      updatedAt: new Date("2026-07-24T00:00:00.000Z"),
    };
    expect(
      deleteCharacterResultSchema.parse({
        deletedCharacterId: "00000000-0000-4000-8000-000000000001",
        deletedThreadCount: 2,
        replacementCharacter,
        activeCharacter: replacementCharacter,
      }),
    ).toMatchObject({
      deletedThreadCount: 2,
      replacementCharacter: { name: "未命名角色" },
    });
    expect(
      characterIdRequestSchema.parse({
        id: "00000000-0000-4000-8000-000000000001",
      }),
    ).toEqual({ id: "00000000-0000-4000-8000-000000000001" });
  });

  it("accepts a sanitized discovered model list", () => {
    expect(discoveredModelListSchema.parse({
      models: [{
        id: "provider/model",
        displayName: "Model",
        modelType: "languageModel",
        typeSource: "litellm-snapshot",
      }],
      source: "provider",
      warning: null,
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

  it("validates speech requests and discriminated responses", () => {
    const requestId = "00000000-0000-4000-8000-000000000010";
    const characterId = "00000000-0000-4000-8000-000000000001";
    expect(
      availableModelListSchema.parse({
        modelConfigIds: ["00000000-0000-4000-8000-000000000020"],
      }),
    ).toEqual({
      modelConfigIds: ["00000000-0000-4000-8000-000000000020"],
    });
    expect(
      speechGenerateRequestSchema.parse({
        requestId,
        characterId,
        text: "需要朗读的文字",
      }),
    ).toMatchObject({ requestId, characterId });
    expect(speechCancelRequestSchema.parse({ requestId })).toEqual({ requestId });
    expect(
      speechGenerateResponseSchema.parse({
        status: "success",
        requestId,
        audio: new Uint8Array([0x49, 0x44, 0x33]),
        format: "mp3",
        mediaType: "audio/mpeg",
        cacheHit: false,
      }),
    ).toMatchObject({ status: "success", cacheHit: false });
    expect(
      speechGenerateResponseSchema.safeParse({
        status: "success",
        requestId,
        audio: new Uint8Array([1]),
        format: "../wav",
        mediaType: "text/plain",
        cacheHit: false,
      }).success,
    ).toBe(false);
    expect(
      speechGenerateResponseSchema.parse({
        status: "error",
        requestId,
        code: "provider-error",
        message: "语音生成失败。",
      }),
    ).toMatchObject({ status: "error", code: "provider-error" });
  });

  it("validates refreshable speech metadata separately from model settings", () => {
    const base = {
      id: "e76076e7-73a8-42c2-92d7-f9fa8d44f5eb",
      providerConfigId: "d3867f4b-e85f-4ff4-ac2b-974dc39ad832",
      modelType: "speechModel",
      modelId: "gemini-2.5-flash-preview-tts",
      displayName: "Gemini TTS",
      settings: { defaultVoiceId: "Kore" },
      enabled: true,
      createdAt: new Date("2026-07-19T00:00:00.000Z"),
      updatedAt: new Date("2026-07-19T00:00:00.000Z"),
    } as const;
    expect(
      modelConfigSchema.parse({
        ...base,
        metadata: {
          voices: [
            { id: "Kore", displayName: "Kore", description: "Firm" },
          ],
        },
      }).metadata,
    ).toMatchObject({ voices: [{ id: "Kore" }] });
    expect(
      speechModelSettingsSchema.parse({
        defaultVoiceId: "manual-public-voice",
      }),
    ).toMatchObject({ defaultVoiceId: "manual-public-voice" });
    expect(
      modelConfigSchema.safeParse({
        ...base,
        metadata: {
          voices: null,
          defaultVoiceId: "legacy-mixed-default",
        },
      }).success,
    ).toBe(false);
    expect(
      modelConfigSchema.safeParse({
        ...base,
        metadata: {
          voices: [
            { id: "Kore", displayName: "Kore" },
            { id: "Kore", displayName: "Duplicate" },
          ],
        },
      }).success,
    ).toBe(false);
    expect(
      modelConfigSchema.parse({
        ...base,
        metadata: {
          voices: null,
        },
      }).metadata,
    ).toMatchObject({
      voices: null,
    });
    expect(
      speechModelSettingsSchema.safeParse({
        defaultVoiceId: "v".repeat(201),
      }).success,
    ).toBe(false);
  });

  it("requires speech model and voice together while leaving settings to main Adapters", () => {
    expect(
      createCharacterRequestSchema.safeParse({
        name: "角色",
        modelConfigId: null,
        speechModelConfigId: "00000000-0000-4000-8000-000000000020",
        speechVoice: null,
        systemPrompt: "",
      }).success,
    ).toBe(false);
    expect(
      createModelConfigRequestSchema.safeParse({
        providerConfigId: "d3867f4b-e85f-4ff4-ac2b-974dc39ad832",
        modelType: "speechModel",
        modelId: "gpt-4o-mini-tts",
        displayName: null,
        settings: { temperature: 0.2 },
        enabled: true,
      }).success,
    ).toBe(true);
  });

  it.each([
    ["empty app name", appInfoSchema, { name: "", version: "0.1.0", platform: "win32", electronVersion: "43.1.1", nodeVersion: "24.13.1" }],
    ["negative thread count", databaseStatusSchema, { ready: true, journalMode: "wal", threadCount: -1, validationThreadId: "thread", validationThreadRestored: false }],
    ["fractional provider count", aiRuntimeStatusSchema, { ready: true, configuredProviderCount: 0.5, modelCallsEnabled: false }],
    ["unknown property", aiRuntimeStatusSchema, { ready: true, configuredProviderCount: 0, modelCallsEnabled: false, extra: true }],
    ["unknown message field", threadMessagesSchema, { messages: [{ id: "message-1", parent_id: null, format: "ai-sdk/v6", content: {}, extra: true }] }],
    ["unknown chat stream request field", chatStreamRequestSchema, { requestId: "00000000-0000-4000-8000-000000000010", threadId: "thread", characterId: "00000000-0000-4000-8000-000000000001", messages: [], modelConfigId: "00000000-0000-4000-8000-000000000002" }],
    ["unknown chat stream control frame", chatStreamControlFrameSchema, { type: "resume" }],
    ["invalid chat stream byte frame", chatStreamResponseFrameSchema, { type: "data", data: [1, 2, 3] }],
    ["legacy registry ID", createProviderConfigRequestSchema, { registryId: "openai-main", displayName: "OpenAI", providerType: "openai", baseUrl: null, settings: null, enabled: true }],
    ["unsupported provider type", createProviderConfigRequestSchema, { displayName: "Custom", providerType: "arbitrary-package", baseUrl: null, settings: null, enabled: true }],
    ["non-HTTP base URL", createProviderConfigRequestSchema, { displayName: "Custom", providerType: "openai-compatible", baseUrl: "file:///secret", settings: null, enabled: true }],
    ["renderer-selected credential reference", createProviderConfigRequestSchema, { displayName: "Custom", providerType: "openai-compatible", baseUrl: "https://example.com/v1", credentialRef: "safe-storage/12345678-1234-4123-8123-123456789abc", settings: null, enabled: true }],
    ["unsupported model type", createModelConfigRequestSchema, { providerConfigId: "d3867f4b-e85f-4ff4-ac2b-974dc39ad832", modelType: "audioModel", modelId: "model", displayName: null, settings: null, enabled: true }],
    ["blank character name", updateCharacterRequestSchema, { id: "00000000-0000-4000-8000-000000000001", name: "" }],
    ["blank created character name", createCharacterRequestSchema, { name: "", modelConfigId: null, systemPrompt: "" }],
    ["unknown character field", updateCharacterRequestSchema, { id: "00000000-0000-4000-8000-000000000001", name: "星澜", providerId: "secret" }],
    ["invalid deleted thread count", deleteCharacterResultSchema, {
      deletedCharacterId: "00000000-0000-4000-8000-000000000001",
      deletedThreadCount: -1,
      replacementCharacter: {},
      activeCharacter: {},
    }],
  ])("rejects %s", (_name, schema, value) => {
    expect(schema.safeParse(value).success).toBe(false);
  });
});
