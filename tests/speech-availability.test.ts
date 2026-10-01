import { emptyAppSettings } from "./defaultSettings";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Character, KataruneApi } from "../src/shared/ipc";
import { isCharacterSpeechAvailable } from "../src/renderer/src/speech/speechAvailability";

const speechModelConfigId = "00000000-0000-4000-8000-000000000020";
const character: Character = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Character",
  portraitAssetId: null,
  useDefaultSpeechModel: false, useDefaultSpeechVoice: false,
  modelConfigId: null,
  speechModelConfigId,
  speechVoice: "alloy",
  systemPrompt: "",
  createdAt: new Date("2026-07-30T00:00:00.000Z"),
  updatedAt: new Date("2026-07-30T00:00:00.000Z"),
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("renderer speech availability", () => {
  it("uses the main Runtime callable-model result", async () => {
    const listAvailableModels = vi.fn(async () => ({
      modelConfigIds: [speechModelConfigId],
    }));
    vi.stubGlobal("window", {
      katarune: {
        listAvailableModels,
        fetchModelConfig: async () => ({ id: speechModelConfigId, modelType: "speechModel", settings: null }) as Awaited<ReturnType<KataruneApi["fetchModelConfig"]>>,
      } as Partial<KataruneApi>,
    });

    await expect(isCharacterSpeechAvailable(character, emptyAppSettings)).resolves.toBe(true);
    expect(listAvailableModels).toHaveBeenCalledOnce();
  });

  it("does not query main when the character has no complete speech binding", async () => {
    const listAvailableModels = vi.fn();
    vi.stubGlobal("window", {
      katarune: {
        listAvailableModels,
        fetchModelConfig: async () => ({ id: speechModelConfigId, modelType: "speechModel", settings: null }) as Awaited<ReturnType<KataruneApi["fetchModelConfig"]>>,
      } as Partial<KataruneApi>,
    });

    await expect(
      isCharacterSpeechAvailable({
        ...character,
        speechModelConfigId: null,
        speechVoice: null,
      }, emptyAppSettings),
    ).resolves.toBe(false);
    expect(listAvailableModels).not.toHaveBeenCalled();
  });
});
