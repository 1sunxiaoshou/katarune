import { mkdir, writeFile, readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createFishAudio } from "../src/main/ai/fishAudioProvider";
import { hasTimestampedSpeech } from "../src/main/ai/timestampedSpeech";
import { hasStreamingSpeech, pcmWav } from "../src/main/ai/streamingSpeech";
import { wavDuration } from "../src/main/ai/wavDuration";
import { createHash } from "node:crypto";
import { extractSpokenText } from "../src/main/speech/spokenText";

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
  const profileArgument = process.argv.indexOf("--user-data");
  const directory = profileArgument >= 0 ? process.argv[profileArgument + 1] : join(app.getPath("appData"), "katarune-development");
  if (!directory) throw new Error("Missing user data path.");
  app.setPath("userData", directory);
  await app.whenReady();
  exit = code => app.exit(code);
  const { default: Database } = await import("better-sqlite3");
  stage = "saved-configuration";
  const db = new Database(join(directory, "katarune.sqlite"), { readonly: true });
  const row = db.prepare(`SELECT CASE WHEN c.use_default_speech_voice = 1 THEN
      CASE WHEN m.id = s.default_speech_model_config_id THEN s.default_speech_voice ELSE json_extract(m.settings, '$.defaultVoiceId') END
      ELSE CASE WHEN c.speech_model_config_id = m.id THEN c.speech_voice END END voice,
      p.credential_ref credential, p.base_url baseURL, p.id providerId, m.model_id modelId
    FROM characters c JOIN app_state a ON a.active_character_id = c.id CROSS JOIN app_settings s
    JOIN model_configs m ON m.id = CASE WHEN c.use_default_speech_model = 1 THEN s.default_speech_model_config_id ELSE c.speech_model_config_id END
    JOIN provider_configs p ON p.id = m.provider_config_id
    WHERE p.provider_type = 'fish-audio' AND p.enabled = 1 AND m.enabled = 1
    AND voice IS NOT NULL LIMIT 1`).get() as
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
let rawCapture: Promise<void> | undefined;
const model = createFishAudio({ apiKey: key, ...(baseURL ? { baseURL } : {}),
  ...(process.argv.includes("--capture-raw") ? { fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = await fetch(input, init);
    rawCapture = response.clone().text().then(async raw => {
      const directory = resolve(".test-dist/fish-raw");
      await mkdir(directory, { recursive: true });
      await writeFile(join(directory, "response.sse"), raw);
    });
    void rawCapture.catch(() => {});
    return response;
  } } : {}) }).speechModel!(modelId);
if (!hasTimestampedSpeech(model)) throw new Error("Timestamp capability missing.");
if (process.argv.includes("--streaming")) {
  if (!hasStreamingSpeech(model)) throw new Error("Streaming capability missing.");
  const sampleIndex = Number(process.argv.find(arg => arg.startsWith("--sample="))?.split("=")[1] ?? 0);
  const samples = ["你好，今天很高兴见到你。我们一起来测试流式语音。",
    "我们来观察语音播放是否连续。第一段介绍今天的安排，第二段说明测试过程，最后一起确认声音有没有被打断。即使网络偶尔慢一点，也希望动作和字幕能够跟随实际播放。",
    "先慢慢说一句话。接着换一个话题，聊聊窗外的天气。然后继续介绍这个小实验：声音会分成许多片段陆续到达，播放器需要把它们连贯地读出来。我们既要照顾开始说话的速度，也要尽量减少中间的停顿。最后这句话用于检查尾音是否完整。",
    "今天想和你一起沿着河边慢慢散步，看看傍晚的阳光怎样穿过树叶落在小路上，再听听远处传来的脚步声和风吹过草地的声音，如果走累了我们就找一张长椅坐下来聊聊最近发生的事情，等到天色渐渐暗下来以后再一起回家准备晚饭，把这段平静又温暖的时光好好记在心里。下一句应该等前面的声音说完以后才开始显示和播放。"];
  const textArgument = process.argv.indexOf("--text-file");
  const text = textArgument >= 0
    ? extractSpokenText(await readFile(resolve(process.argv[textArgument + 1]!), "utf8"))
    : samples[sampleIndex];
  if (!text) throw new Error("Invalid speech sample.");
  const directory = resolve(textArgument >= 0 ? ".test-dist/fish-streaming-live/custom"
    : sampleIndex === 0 ? ".test-dist/fish-streaming-live" : `.test-dist/fish-streaming-live/sample-${sampleIndex}`);
  await mkdir(directory, { recursive: true });
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
  await rawCapture;
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
