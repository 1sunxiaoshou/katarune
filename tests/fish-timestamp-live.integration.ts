import { mkdir, writeFile, readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createFishAudio } from "../src/main/ai/fishAudioProvider";
import { hasTimestampedSpeech } from "../src/main/ai/timestampedSpeech";
import { hasStreamingSpeech, pcmWav } from "../src/main/ai/streamingSpeech";
import { wavDuration } from "../src/main/ai/wavDuration";
import { createHash } from "node:crypto";

let stage = "environment";
async function main() {
try {
  process.loadEnvFile(resolve(".env.local"));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  process.loadEnvFile(resolve(".env"));
}
let key = process.env.KATARUNE_TEST_FISH_AUDIO_API_KEY;
let voice = process.env.KATARUNE_TEST_FISH_AUDIO_VOICE_ID;
let baseURL: string | undefined;
let modelId = "s2.1-pro-free";
let voiceKey: string | undefined;
let exit: ((code: number) => void) | undefined;
if (process.argv.includes("--saved-config")) {
  stage = "electron";
  const { app, safeStorage } = await import("electron");
  app.setPath("userData", join(app.getPath("appData"), "katarune-development"));
  await app.whenReady();
  exit = code => app.exit(code);
  const { default: Database } = await import("better-sqlite3");
  stage = "saved-configuration";
  const directory = join(app.getPath("appData"), "katarune-development");
  const db = new Database(join(directory, "katarune.sqlite"), { readonly: true });
  const row = db.prepare(`SELECT c.speech_voice voice, p.credential_ref credential, p.base_url baseURL, p.id providerId, m.model_id modelId
    FROM characters c JOIN model_configs m ON m.id = c.speech_model_config_id
    JOIN provider_configs p ON p.id = m.provider_config_id
    WHERE p.provider_type = 'fish-audio' AND p.enabled = 1 AND m.enabled = 1
    AND c.speech_voice IS NOT NULL ORDER BY c.created_at DESC LIMIT 1`).get() as
    { voice: string; credential: string; baseURL: string | null; providerId: string; modelId: string } | undefined;
  db.close();
  if (!row || !/^safe-storage\/[0-9a-f-]{36}$/.test(row.credential)) throw new Error("No saved Fish voice configuration.");
  modelId = row.modelId;
  voiceKey = createHash("sha256").update(JSON.stringify([row.providerId, modelId, row.voice])).digest("hex");
  if (process.argv.includes("--profile-info")) { console.log(JSON.stringify({ modelId, voiceKey })); exit(0); return; }
  stage = "credential-resolution";
  const decrypted = await safeStorage.decryptStringAsync(await readFile(join(directory, "credentials", `${row.credential.split("/")[1]}.bin`)));
  key = decrypted.result; voice = row.voice; baseURL = row.baseURL ?? undefined;
}
if (!key || !voice) throw new Error("Fish live test credentials are not configured.");
const model = createFishAudio({ apiKey: key, ...(baseURL ? { baseURL } : {}) }).speechModel!(modelId);
if (!hasTimestampedSpeech(model)) throw new Error("Timestamp capability missing.");
if (process.argv.includes("--streaming")) {
  if (!hasStreamingSpeech(model)) throw new Error("Streaming capability missing.");
  const directory = resolve(".test-dist/fish-streaming-live");
  await mkdir(directory, { recursive: true });
  const text = "你好，今天很高兴见到你。我们一起来测试流式语音。";
  const started = performance.now();
  const events: object[] = [];
  const audio: Uint8Array[] = [];
  let sampleRate = 0;
  for await (const event of model.streamSpeech({ text, voice, abortSignal: AbortSignal.timeout(120_000) })) {
    const elapsedMs = performance.now() - started;
    events.push(event.type === "audio" ? { type: event.type, elapsedMs, bytes: event.audio.length } : { ...event, elapsedMs });
    if (event.type === "format") sampleRate = event.sampleRate;
    if (event.type === "audio") audio.push(event.audio);
  }
  const wav = pcmWav(Buffer.concat(audio), sampleRate);
  await writeFile(join(directory, "speech.wav"), wav);
  await writeFile(join(directory, "events.json"), JSON.stringify({ text, events }, null, 2));
  console.log(JSON.stringify({ streaming: true, chunks: audio.length, duration: wavDuration(wav), elapsedMs: performance.now() - started }));
  exit?.(0); return;
}
const output = resolve(".test-dist/lipsync-live");
await mkdir(output, { recursive: true });
await writeFile(join(output, "voice-profile-key.json"), JSON.stringify({ modelId, voiceKey }));
const samples = process.argv.includes("--calibration") ? [
  ["A", "あー、あー、あー、あー、あー、あー、あー、あー。"],
  ["I", "いー、いー、いー、いー、いー、いー、いー、いー。"],
  ["U", "うー、うー、うー、うー、うー、うー、うー、うー。"],
  ["E", "えー、えー、えー、えー、えー、えー、えー、えー。"],
  ["O", "おー、おー、おー、おー、おー、おー、おー、おー。"],
] : [
  ["zh", "你好，今天也很高兴见到你。我们一起来测试语音和嘴型同步。"],
  ["ja", "こんにちは。今日はいい天気ですね。一緒にお話ししましょう。"],
  ["en", "Hello there. It is a beautiful day. Let's test our voice and lip synchronization."],
];
for (const [language, text] of samples as [string, string][]) {
  stage = `synthesis-${language}`;
  const artifact = await model.generateWithTimestamps({ text, voice, outputFormat: "wav", abortSignal: AbortSignal.timeout(120_000) });
  await writeFile(join(output, `${language}.wav`), artifact.audio);
  await writeFile(join(output, `${language}.json`), JSON.stringify({ text, segments: artifact.segments ?? [] }, null, 2));
  console.log(JSON.stringify({ language, duration: wavDuration(artifact.audio), segments: artifact.segments?.length ?? 0 }));
}
exit?.(0);
}
void main().catch(async (error: unknown) => {
  console.error(JSON.stringify({ stage, error: error instanceof Error ? error.name : "unknown",
    detail: error instanceof Error && /^(No saved Fish|Fish timestamp synthesis failed|Invalid WAV|Truncated WAV|Unsupported WAV)/.test(error.message) ? error.message : "Live test failed." }));
  if (process.argv.includes("--saved-config")) (await import("electron")).app.exit(1);
  else process.exitCode = 1;
});
