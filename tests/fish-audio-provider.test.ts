import { describe, expect, it, vi } from "vitest";

import { createFishAudio } from "../src/main/ai/fishAudioProvider";

function wavPayload(): Uint8Array {
  const wav = new Uint8Array(44);
  wav.set(new TextEncoder().encode("RIFF"), 0);
  wav.set(new TextEncoder().encode("WAVE"), 8);
  return wav;
}

function wavArrayBuffer(): ArrayBuffer {
  const wav = wavPayload();
  return wav.buffer.slice(
    wav.byteOffset,
    wav.byteOffset + wav.byteLength,
  ) as ArrayBuffer;
}

describe("Fish Audio SpeechModel", () => {
  it("maps AI SDK speech options to the Fish Audio TTS endpoint", async () => {
    const fetchImplementation = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        expect(String(input)).toBe("https://api.fish.audio/v1/tts");
        const headers = new Headers(init?.headers);
        expect(headers.get("Authorization")).toBe("Bearer fish-key");
        expect(headers.get("model")).toBe("s2.1-pro-free");
        expect(headers.get("Content-Type")).toBe("application/json");
        expect(JSON.parse(String(init?.body))).toEqual({
          text: "你好",
          reference_id: "voice-123",
          format: "wav",
          prosody: { speed: 1.25 },
        });
        return new Response(wavArrayBuffer(), {
          status: 200,
          headers: { "Content-Type": "audio/wav" },
        });
      },
    );
    const provider = createFishAudio({
      apiKey: "fish-key",
      fetch: fetchImplementation,
    });
    const result = await provider.speechModel!("s2.1-pro-free").doGenerate({
      text: "你好",
      voice: "voice-123",
      outputFormat: "wav",
      speed: 1.25,
    });

    expect(result.audio).toEqual(wavPayload());
    expect(result.warnings).toEqual([]);
    expect(result.response.modelId).toBe("s2.1-pro-free");
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });

  it("falls back to WAV and reports unsupported generic speech options", async () => {
    const fetchImplementation = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        new Response(wavArrayBuffer(), { status: 200 }),
    );
    const provider = createFishAudio({
      apiKey: "fish-key",
      fetch: fetchImplementation,
    });
    const result = await provider.speechModel!("s2-pro").doGenerate({
      text: "Hello",
      outputFormat: "aac",
      instructions: "Whisper",
      language: "en",
      speed: 3,
    });

    expect(result.warnings.map((warning) =>
      warning.type === "unsupported" ? warning.feature : warning.type,
    )).toEqual(["outputFormat", "instructions", "language", "speed"]);
    const request = JSON.parse(
      String(fetchImplementation.mock.calls[0]?.[1]?.body),
    );
    expect(request).toEqual({ text: "Hello", format: "wav" });
  });
});
