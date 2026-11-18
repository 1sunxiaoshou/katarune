import { afterEach, expect, it, vi } from "vitest";
import { fetchDeepSeekPage, recognizeDeepSeekDocument, synthesizeDeepSeekSpeech, transcribeDeepSeekRecording } from "../src/main/ai/deepSeekTools";
import { pcmWav } from "../src/main/ai/streamingSpeech";

afterEach(() => vi.unstubAllGlobals());

it("reads through the official Fetch endpoint and rejects nonpublic literal targets before sending", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json({ title: "Example", content: "# Example" }));
  vi.stubGlobal("fetch", fetch);
  await expect(fetchDeepSeekPage("fixture", "http://127.0.0.1/private")).rejects.toThrow();
  await expect(fetchDeepSeekPage("fixture", "https://user:secret@example.com")).rejects.toThrow();
  expect(fetch).not.toHaveBeenCalled();
  await expect(fetchDeepSeekPage("fixture", "https://example.com/")).resolves.toEqual({
    title: "Example", content: "# Example", truncated: false,
  });
  expect(fetch).toHaveBeenCalledWith(new URL("https://api.deepseek.com/v1/tools/fetch"), expect.objectContaining({
    body: '{"url":"https://example.com/"}', redirect: "error",
  }));
});

it("uploads only the intended file and parameters for OCR and ASR", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(Response.json({ pages: [{ index: 0, text: "Fixture", finish_reason: "stop" }] }))
    .mockResolvedValueOnce(Response.json({ text: "Fixture speech", duration_ms: 12 }));
  vi.stubGlobal("fetch", fetch);
  const file = { filename: "document.pdf", mediaType: "application/pdf", data: new TextEncoder().encode("Fixture") };
  await expect(recognizeDeepSeekDocument("fixture", file, "rich_layout_recognition")).resolves.toMatchObject({
    pages: [{ index: 0, text: "Fixture" }],
  });
  const audio = { filename: "audio.wav", mediaType: "audio/wav", data: pcmWav(new Uint8Array(320), 16_000) };
  await expect(transcribeDeepSeekRecording("fixture", audio)).resolves.toEqual({ text: "Fixture speech", duration_ms: 12 });
  const [ocr, asr] = fetch.mock.calls;
  expect(ocr?.[0]).toEqual(new URL("https://api.deepseek.com/v1/tools/ocr"));
  expect(asr?.[0]).toEqual(new URL("https://api.deepseek.com/v1/tools/asr"));
  const ocrForm = ocr?.[1]?.body;
  const asrForm = asr?.[1]?.body;
  if (!(ocrForm instanceof FormData) || !(asrForm instanceof FormData)) throw new Error("Missing multipart uploads");
  expect([...ocrForm.keys()]).toEqual(["file", "purpose"]);
  expect(ocrForm.get("purpose")).toBe("rich_layout_recognition");
  expect(ocrForm.get("file")).toMatchObject({ name: file.filename, size: file.data.length });
  expect([...asrForm.keys()]).toEqual(["file"]);
  expect(asrForm.get("file")).toMatchObject({ name: audio.filename, size: audio.data.length });
});

it("writes a complete WAV from DeepSeek PCM and rejects a non-audio response", async () => {
  const pcm = new Uint8Array([1, 0, 2, 0]);
  const fetch = vi.fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(Response.json({ error: "fixture" }))
    .mockResolvedValueOnce(new Response(pcm, { headers: { "Content-Type": "audio/pcm" } }));
  vi.stubGlobal("fetch", fetch);
  await expect(synthesizeDeepSeekSpeech("fixture", "你好", "tide")).rejects.toThrow("未返回 PCM");
  const wav = await synthesizeDeepSeekSpeech("fixture", "你好", "tide");
  expect(Buffer.from(wav).subarray(0, 4).toString()).toBe("RIFF");
  expect(Buffer.from(wav).readUInt32LE(24)).toBe(24_000);
  expect(wav.subarray(44)).toEqual(Buffer.from(pcm));
  expect(fetch).toHaveBeenLastCalledWith(new URL("https://api.deepseek.com/v1/tools/tts"), expect.objectContaining({
    body: '{"text":"你好","voice_id":"tide","format":"pcm"}',
  }));
});
