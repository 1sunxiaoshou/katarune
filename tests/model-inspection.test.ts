import { describe, expect, it, vi } from "vitest";

import {
  applyModelDefaultVoice,
  inspectModelForPersistence,
} from "../src/main/ai/modelInspection";
import { PROVIDER_DEFINITIONS } from "../src/main/ai/providerDefinitions";
import type { ProviderConfig } from "../src/shared/ipc";

const provider: ProviderConfig = {
  id: "d3867f4b-e85f-4ff4-ac2b-974dc39ad832",
  displayName: "Google",
  providerType: "google",
  baseUrl: null,
  credentialRef: "safe-storage/test",
  settings: null,
  enabled: true,
  createdAt: new Date("2026-07-31T00:00:00.000Z"),
  updatedAt: new Date("2026-07-31T00:00:00.000Z"),
};

describe("model import inspection", () => {
  it("lets a speech-model editor set a manual model default outside the voice catalog", () => {
    expect(
      applyModelDefaultVoice(
        "speechModel",
        {
          voices: [{ id: "owned", displayName: "Owned" }],
          defaultVoiceId: null,
        },
        "public-or-shared-voice",
      ),
    ).toEqual({
      voices: [{ id: "owned", displayName: "Owned" }],
      defaultVoiceId: "public-or-shared-voice",
    });
    expect(() =>
      applyModelDefaultVoice("languageModel", null, "voice"),
    ).toThrow("只有语音生成模型");
  });

  it("persists trained voices owned by the active Fish Audio workspace", async () => {
    const fishProvider: ProviderConfig = {
      ...provider,
      displayName: "Fish Audio",
      providerType: "fish-audio",
    };
    const fetchImplementation = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(String(input));
        expect(url.origin + url.pathname).toBe("https://api.fish.audio/model");
        expect(url.searchParams.get("page_size")).toBe("100");
        expect(url.searchParams.get("self")).toBe("true");
        expect(url.searchParams.get("sort_by")).toBe("created_at");
        expect(new Headers(init?.headers).get("Authorization")).toBe(
          "Bearer fish-key",
        );
        if (url.searchParams.get("page_number") === "1") {
          return Response.json({
            total: 101,
            has_more: true,
            items: [
              {
                _id: "voice-one",
                type: "tts",
                title: "角色音色",
                description: "账号自有克隆音色",
                state: "trained",
              },
              {
                _id: "not-ready",
                type: "tts",
                title: "训练中",
                state: "training",
              },
            ],
          });
        }
        expect(url.searchParams.get("page_number")).toBe("2");
        return Response.json({
          total: 101,
          has_more: false,
          items: [
            {
              _id: "voice-two",
              type: "tts",
              title: "Second Voice",
              state: "trained",
            },
          ],
        });
      },
    );

    const result = await inspectModelForPersistence({
      provider: fishProvider,
      definition: PROVIDER_DEFINITIONS["fish-audio"],
      apiKey: "fish-key",
      modelId: "s2.1-pro-free",
      modelTypeHint: "speechModel",
      allowInspectionFallback: false,
      fetchImplementation,
    });

    expect(result).toEqual({
      modelType: "speechModel",
      suggestedDisplayName: "Fish Audio S2.1 Pro Free",
      speechMetadata: {
        voices: [
          {
            id: "voice-one",
            displayName: "角色音色",
            description: "账号自有克隆音色",
          },
          { id: "voice-two", displayName: "Second Voice" },
        ],
        defaultVoiceId: null,
      },
    });
    expect(fetchImplementation).toHaveBeenCalledTimes(2);
  });

  it("keeps Fish Audio import usable in manual Voice ID mode when voice discovery fails", async () => {
    const fishProvider: ProviderConfig = {
      ...provider,
      displayName: "Fish Audio",
      providerType: "fish-audio",
    };
    await expect(
      inspectModelForPersistence({
        provider: fishProvider,
        definition: PROVIDER_DEFINITIONS["fish-audio"],
        apiKey: "fish-key",
        modelId: "s2-pro",
        modelTypeHint: "speechModel",
        allowInspectionFallback: true,
        fetchImplementation: vi.fn(async () =>
          new Response(null, { status: 503 }),
        ),
      }),
    ).resolves.toMatchObject({
      modelType: "speechModel",
      speechMetadata: { voices: null, defaultVoiceId: null },
    });
  });

  it("lets the Provider result determine type and model-level voices", async () => {
    const result = await inspectModelForPersistence({
      provider,
      definition: PROVIDER_DEFINITIONS.google,
      apiKey: "google-key",
      modelId: "gemini-2.5-flash-preview-tts",
      modelTypeHint: "speechModel",
      allowInspectionFallback: false,
      fetchImplementation: vi.fn(async () =>
        Response.json({
          models: [
            {
              name: "models/gemini-2.5-flash-preview-tts",
              displayName: "Gemini 2.5 Flash TTS",
            },
          ],
        })),
    });

    expect(result).toMatchObject({
      modelType: "speechModel",
      suggestedDisplayName: "Gemini 2.5 Flash TTS",
      speechMetadata: {
        defaultVoiceId: "Kore",
      },
    });
    expect(result.speechMetadata?.voices).toHaveLength(30);
  });

  it("rejects a renderer hint that conflicts with Provider inspection", async () => {
    await expect(
      inspectModelForPersistence({
        provider,
        definition: {
          inspectModel: async () => ({
            modelType: "embeddingModel",
            displayName: null,
            speechMetadata: null,
          }),
        },
        apiKey: "key",
        modelId: "model",
        modelTypeHint: "languageModel",
        allowInspectionFallback: true,
      }),
    ).rejects.toThrow("不一致");
  });

  it("requires a manual type when the Provider cannot classify a model", async () => {
    await expect(
      inspectModelForPersistence({
        provider,
        definition: {
          inspectModel: async () => ({
            modelType: null,
            displayName: null,
            speechMetadata: null,
          }),
        },
        apiKey: "key",
        modelId: "unknown",
        modelTypeHint: null,
        allowInspectionFallback: true,
      }),
    ).rejects.toThrow("手动选择");
  });

  it("falls back to manual Voice ID metadata when speech inspection fails", async () => {
    await expect(
      inspectModelForPersistence({
        provider,
        definition: {
          inspectModel: async () => {
            throw new Error("voice endpoint unavailable");
          },
        },
        apiKey: "key",
        modelId: "manual-tts",
        modelTypeHint: "speechModel",
        allowInspectionFallback: true,
      }),
    ).resolves.toMatchObject({
      modelType: "speechModel",
      speechMetadata: {
        voices: null,
        defaultVoiceId: null,
      },
    });
  });
});
