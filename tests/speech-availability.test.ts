import { afterEach, describe, expect, it, vi } from "vitest";
import type { Character, KataruneApi } from "../src/shared/ipc";
import { isCharacterSpeechAvailable } from "../src/renderer/src/speech/speechAvailability";

const speechModelConfigId = "00000000-0000-4000-8000-000000000020";
const character: Character = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Character",
  portraitAssetId: null,
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
    const listAvailableSpeechModels = vi.fn(async () => ({
      modelConfigIds: [speechModelConfigId],
    }));
    vi.stubGlobal("window", {
      katarune: {
        listAvailableSpeechModels,
      } as Partial<KataruneApi>,
    });

    await expect(isCharacterSpeechAvailable(character)).resolves.toBe(true);
    expect(listAvailableSpeechModels).toHaveBeenCalledOnce();
  });

  it("does not query main when the character has no complete speech binding", async () => {
    const listAvailableSpeechModels = vi.fn();
    vi.stubGlobal("window", {
      katarune: {
        listAvailableSpeechModels,
      } as Partial<KataruneApi>,
    });

    await expect(
      isCharacterSpeechAvailable({
        ...character,
        speechModelConfigId: null,
        speechVoice: null,
      }),
    ).resolves.toBe(false);
    expect(listAvailableSpeechModels).not.toHaveBeenCalled();
  });
});
