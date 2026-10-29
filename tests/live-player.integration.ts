import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join, dirname } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { app } from "electron";
import { MockLanguageModelV4, MockSpeechModelV4 } from "ai/test";
import { validateUIMessages } from "ai";
import { openDatabase } from "../src/main/database/database";
import { validateModelMetadata, validateModelSettings, validateProviderSettings } from "../src/main/ai/providerDefinitions";
import { createAssetService } from "../src/main/assets/assetService";
import { CharacterPackageService } from "../src/main/characters/characterPackageService";
import { AvatarService } from "../src/main/avatar/avatarService";
import { BilibiliConnection } from "../src/main/live/bilibili";
import { LiveMedia } from "../src/main/live/media";
import { LiveService } from "../src/main/live/liveService";
import { pcmWav } from "../src/main/ai/streamingSpeech";
import { DEFAULT_LIVE_SETTINGS } from "../src/shared/live";
import { kataruneAiToolkit } from "../src/main/ai/toolkit";
import { initializeDiagnostics } from "../src/main/diagnostics/logger";
import { type AiRuntime } from "../src/main/ai/runtime";

const directory = mkdtempSync(join(tmpdir(), "katarune-live-player-"));
app.setPath("userData", directory);
const output = resolve(".test-dist/live-player");
const executable = resolve(process.env.KATARUNE_LIVE_PLAYER ?? "unity/KataruneAvatar/Builds/Windows/KataruneAvatar.exe");
const mediaRoot = resolve(process.env.KATARUNE_LIVE_TOOLS ?? "resources/live-media");
class OfficialFixture extends BilibiliConnection {
  override async connect() { this.onState({ connection: "connected", broadcast: "unknown", roomId: "101", roomName: "合成官方连接", roomCover: "", roomDescription: "" }); }
  override async disconnect() { this.onState({ connection: "disconnected", broadcast: "unknown", roomId: "101", roomName: "合成官方连接", roomCover: "", roomDescription: "" }); }
}
void app.whenReady().then(async () => {
  await mkdir(output, { recursive: true });
  Object.assign(globalThis, { __dirname: resolve("out/main") });
  const diagnostics = initializeDiagnostics(join(output, "diagnostics"), "test");
  const database = openDatabase({ userDataPath: directory, appPath: process.cwd(), configValidator: { validateModelMetadata, validateModelSettings, validateProviderSettings } });
  const avatar = new AvatarService(executable, join(directory, "avatar-runtime"));
  const media = new LiveMedia(mediaRoot, join(directory, "media"));
  let live: LiveService | undefined;
  try {
    const assets = createAssetService({ userDataPath: directory, characterResourcesPath: resolve("resources/characters") });
    const packages = new CharacterPackageService(database, assets, directory, resolve("resources/characters/default-package"), join(dirname(executable), "KataruneAvatar_Data/KataruneLocal"), async () => {});
    await packages.initialize();
    avatar.configurePackages(id => packages.runtime(database.fetchCharacter(id).packageId!));
    const owner = database.listCharacters().characters[0]!;
    const provider = database.createProviderConfig({ displayName: "合成模型", providerType: "openai-compatible", baseUrl: "http://127.0.0.1:1234/v1", settings: null, enabled: true });
    const model = database.createModelConfig({ providerConfigId: provider.id, modelType: "languageModel", modelId: "test-model", displayName: null, metadata: null, settings: {}, enabled: true });
    const speech = database.createModelConfig({ providerConfigId: provider.id, modelType: "speechModel", modelId: "test-voice", displayName: null, metadata: null, settings: { defaultVoiceId: "voice" }, enabled: true });
    database.updateCharacter({ id: owner.id, modelConfigId: model.id, speechModelConfigId: speech.id, speechVoice: "voice" });
    database.saveLiveConfig({ ...DEFAULT_LIVE_SETTINGS, characterId: owner.id, replyIntervalSeconds: 5, proactive: false, port: 19437 });
    const pcm = Buffer.alloc(48000 * 2 * 4);
    for (let sample = 0; sample < pcm.length / 2; sample++) pcm.writeInt16LE(Math.round(.15 * 32767 * Math.sin(sample / 48000 * 2 * Math.PI * 660)), sample * 2);
    await mkdir(join(directory, "speech"), { recursive: true });
    avatar.configureSpeech({ generate: async (_id, text, signal) => { signal.throwIfAborted(); return { audio: pcmWav(pcm, 48000), format: "wav", mediaType: "audio/wav", cacheHit: false, spokenText: text }; } }, join(directory, "speech"));
    let generations = 0, now = 100_000, requestDance = false, danceScheduled = false;
    const language = new MockLanguageModelV4({ doStream: async () => ({ stream: new ReadableStream({ start(controller) {
      generations++;
      if (requestDance && !danceScheduled) {
        danceScheduled = true;
        controller.enqueue({ type: "tool-call", toolCallId: "live-dance", toolName: "avatar_play", input: JSON.stringify({ action: "action:sad-water" }) });
        controller.enqueue({ type: "finish", finishReason: { unified: "tool-calls", raw: undefined }, usage: { inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 1, text: 1, reasoning: undefined } } }); controller.close(); return;
      }
      controller.enqueue({ type: "text-start", id: "text" }); controller.enqueue({ type: "text-delta", id: "text", delta: "欢迎来到直播间，这是完整主持链路的合成测试。" }); controller.enqueue({ type: "text-end", id: "text" });
      controller.enqueue({ type: "finish", finishReason: { unified: "stop", raw: undefined }, usage: { inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 1, text: 1, reasoning: undefined } } }); controller.close();
    } }) }) });
    const connection = new OfficialFixture();
    const credentials = new Map<string, string>();
    const aiRuntime: Pick<AiRuntime, "resolveLanguageModel" | "resolveSpeechModel"> = { resolveLanguageModel: () => language, resolveSpeechModel: () => ({ model: new MockSpeechModelV4(), output: { requestFormat: "wav", format: "wav", mediaType: "audio/wav" }, normalizeAudio: () => { throw new Error("unused"); }, validateAudio: () => true }) };
    live = new LiveService({ database, avatar, media, connection, now: () => now,
      credentials: { put: async value => { credentials.set("fixture", value); return "fixture"; }, resolve: async () => credentials.get("fixture")!, delete: async () => {} },
      aiRuntime,
    });
    const previewTimes: number[] = [];
    const previewChunks: Uint8Array[] = [];
    media.onPreview = frame => {
      previewTimes.push(performance.now());
      if (!previewChunks.length) previewChunks.push(frame.initialization);
      if (previewChunks.length < 30) previewChunks.push(frame.fragment);
    };
    await live.setCredentials({ appId: "123", accessKey: "synthetic", accessSecret: "synthetic", identityCode: "synthetic" });
    const desktopBinding = { characterId: owner.id, threadId: "desktop-before-live" };
    database.initializeThread(desktopBinding.threadId, owner.id);
    await avatar.start(desktopBinding);
    await live.start(); assert.equal(live.status.phase, "running"); assert.equal(generations, 0);
    const recording = promisify(execFile)(join(mediaRoot, "ffmpeg.exe"), ["-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-i", "rtmp://127.0.0.1:19437/katarune/live", "-t", "12", "-c", "copy", join(output, "capture.flv")], { windowsHide: true, timeout: 25000 });
    connection.onState({ connection: "connected", broadcast: "live", roomId: "101", roomName: "合成官方连接", roomCover: "", roomDescription: "" });
    const emit = (id: string) => connection.onEvent({ id, kind: "danmaku", roomId: "101", timestamp: now, userId: "viewer", userName: "观众", text: "你好", giftId: "", giftName: "", quantity: 0 });
    const wait = async (predicate: () => boolean, label: string, timeout = 15000) => { const end = Date.now() + timeout; while (!predicate()) { assert.ok(Date.now() < end, `${label}: ${JSON.stringify(live!.status)}`); assert.equal(live!.status.error, null); await new Promise(resolve => setTimeout(resolve, 25)); } };
    emit("one"); now += 6000;
    await wait(() => generations === 1 && !live!.status.generating, "First host reply");
    const history = database.loadThreadMessages(live.status.threadId!, owner.id).messages;
    await writeFile(join(output, "history.json"), JSON.stringify(history, null, 2));
    await validateUIMessages({ messages: history.map(row => ({ id: row.id, ...row.content })) });
    assert.ok(avatar.livePlaybackBusy); emit("two"); now += 6000;
    await new Promise(resolve => setTimeout(resolve, 500)); assert.equal(generations, 1, "New round started before actual speech drained");
    await wait(() => generations === 2 && !live!.status.generating, "Second host reply");
    await wait(() => !avatar.livePlaybackBusy, "Actual speech completion");
    await recording;
    assert.ok(previewTimes.length > 5, "Full-size preview stopped producing segments");
    await writeFile(join(output, "preview.mp4"), Buffer.concat(previewChunks));
    const previewStreams = JSON.parse((await promisify(execFile)(join(mediaRoot, "ffprobe.exe"), ["-v", "error", "-show_streams", "-of", "json", join(output, "preview.mp4")], { windowsHide: true, timeout: 10000 })).stdout).streams;
    assert.ok(previewStreams.some((stream: { codec_name: string; width: number; height: number }) => stream.codec_name === "h264" && stream.width === DEFAULT_LIVE_SETTINGS.width && stream.height === DEFAULT_LIVE_SETTINGS.width * 9 / 16));
    assert.ok(previewStreams.some((stream: { codec_name: string }) => stream.codec_name === "aac"));
    const streams = JSON.parse((await promisify(execFile)(join(mediaRoot, "ffprobe.exe"), ["-v", "error", "-show_streams", "-of", "json", join(output, "capture.flv")], { windowsHide: true, timeout: 10000 })).stdout).streams;
    assert.ok(streams.some((stream: { codec_name: string; width: number; height: number; r_frame_rate: string }) => stream.codec_name === "h264" && stream.width === DEFAULT_LIVE_SETTINGS.width && stream.height === DEFAULT_LIVE_SETTINGS.width * 9 / 16 && stream.r_frame_rate === "60/1"), "RTMP resolution or source frame rate differs from managed output");
    assert.equal(live.status.phase, "running", "Closing the receiver stopped hosting");
    await promisify(execFile)(join(mediaRoot, "ffmpeg.exe"), ["-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-i", join(output, "capture.flv"), "-vn", "-ac", "1", "-ar", "48000", "-f", "f32le", join(output, "audio.f32")], { windowsHide: true, timeout: 10000 });
    const audio = await readFile(join(output, "audio.f32")); let peak = 0;
    for (let offset = 0; offset < audio.length; offset += 4) peak = Math.max(peak, Math.abs(audio.readFloatLE(offset)));
    assert.ok(peak > .02); assert.equal(live.status.monitor, false);
    assert.equal(database.loadThreadMessages(live.status.threadId!, owner.id).messages.length, 4);
    if (process.env.KATARUNE_LIVE_DANCE === "1") {
      requestDance = true; emit("dance-request"); now += 6000;
      await wait(() => avatar.status.dance?.state === "started", "Dance start", 30000);
      await wait(() => !live!.status.generating, "Dance Agent step completion");
      assert.equal(generations, 4);
      emit("during-dance"); now += 6000;
      await promisify(execFile)(join(mediaRoot, "ffmpeg.exe"), ["-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-i", "rtmp://127.0.0.1:19437/katarune/live", "-t", "12", "-c", "copy", join(output, "dance.flv")], { windowsHide: true, timeout: 25000 });
      assert.equal(generations, 4, "Host interrupted a blocking performance");
      await promisify(execFile)(join(mediaRoot, "ffmpeg.exe"), ["-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-ss", "5", "-i", join(output, "dance.flv"), "-frames:v", "1", join(output, "dance.png")], { windowsHide: true, timeout: 10000 });
      await promisify(execFile)(join(mediaRoot, "ffmpeg.exe"), ["-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-i", join(output, "dance.flv"), "-vn", "-ac", "1", "-ar", "48000", "-f", "f32le", join(output, "dance-audio.f32")], { windowsHide: true, timeout: 10000 });
      const music = await readFile(join(output, "dance-audio.f32")); let musicPeak = 0;
      for (let offset = 0; offset < music.length; offset += 4) musicPeak = Math.max(musicPeak, Math.abs(music.readFloatLE(offset)));
      assert.ok(musicPeak > .02); console.log("Live dance started; RTMP music and blocked host verified. Waiting for natural completion.");
      await wait(() => avatar.status.dance?.state === "completed", "Natural dance completion", 300000);
      await wait(() => generations === 5 && !avatar.livePlaybackBusy && !live!.status.generating, "Host resumes after dance", 20000);
      console.log("Live dance completed naturally; the next host reply drained successfully.");
    }
    await live.stop(); assert.equal(avatar.status.phase, "ready");
    assert.equal(avatar.liveActive, false); assert.deepEqual(avatar.status.binding, desktopBinding);
    let desktopSpeechStarted = false;
    assert.equal(await avatar.playSpeech(desktopBinding, { audio: pcmWav(Buffer.alloc(48000), 48000), format: "wav", mediaType: "audio/wav", cacheHit: false, spokenText: "桌宠播放恢复测试。" }, new AbortController().signal, () => { desktopSpeechStarted = true; }), true);
    assert.ok(desktopSpeechStarted, "Desktop speech did not resume after live output stopped");
    console.log(`Full live chain passed: real ChatService/AI SDK, SQLite, Player dialogue/drain, hidden video, RTMP audio with monitor off, desktop binding and speech restored; peak=${peak.toFixed(3)}.`);
  } finally {
    if (live?.status.error) console.error(diagnostics.memorySnapshot().filter(line => /failed|error/.test(line)).join("\n"));
    await live?.stop(false); avatar.stop(); database.close(); await kataruneAiToolkit.close();
    await diagnostics.close(true);
    await rm(directory, { recursive: true, force: true }); app.quit();
  }
}).catch(error => { console.error(error); app.exit(1); });
