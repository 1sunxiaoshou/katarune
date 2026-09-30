import { emptyAppSettings } from "./defaultSettings";
import assert from "node:assert/strict";
import { app, safeStorage } from "electron";
import Database from "better-sqlite3";
import { readFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { streamText, type UIMessageChunk } from "ai";
import { createAiRuntime } from "../src/main/ai/runtime";
import { AvatarService } from "../src/main/avatar/avatarService";
import { createSpeechService } from "../src/main/speech/ttsService";
import { createTtsCache } from "../src/main/speech/ttsCache";
import { createSpeechArtifactCache } from "../src/main/speech/speechArtifactCache";
import { characterSchema, modelConfigSchema, providerConfigSchema } from "../src/shared/ipc";

app.setPath("userData", join(app.getPath("appData"), "katarune-development"));
let avatar: AvatarService | undefined;
void app.whenReady().then(async () => {
  const directory = app.getPath("userData");
  const db = new Database(join(directory, "katarune.sqlite"), { readonly: true });
  const now = new Date();
  const selected = db.prepare(`SELECT c.id, c.speech_voice voice, c.speech_model_config_id speech
    FROM characters c JOIN model_configs m ON m.id=c.speech_model_config_id
    JOIN provider_configs p ON p.id=m.provider_config_id
    WHERE p.provider_type='fish-audio' AND p.enabled=1 AND m.enabled=1 ORDER BY c.created_at DESC LIMIT 1`).get() as { id: string; voice: string; speech: string } | undefined;
  const languageRow = db.prepare(`SELECT m.id FROM model_configs m JOIN provider_configs p ON p.id=m.provider_config_id
    WHERE m.model_type='languageModel' AND p.provider_type='deepseek' AND p.enabled=1 AND m.enabled=1 LIMIT 1`).get() as { id: string } | undefined;
  assert.ok(selected && languageRow, "Saved Fish voice and DeepSeek model are required.");
  const models = [selected.speech, languageRow.id].map(id => {
    const r = db.prepare("SELECT * FROM model_configs WHERE id=?").get(id) as Record<string, unknown>;
    return modelConfigSchema.parse({ id: r.id, providerConfigId: r.provider_config_id, modelId: r.model_id,
      modelType: r.model_type, displayName: null, enabled: true, metadata: null,
      settings: r.model_type === "speechModel" ? { defaultVoiceId: selected.voice } : { maxOutputTokens: 100 }, createdAt: now, updatedAt: now });
  });
  const providers = models.map(model => {
    const r = db.prepare("SELECT * FROM provider_configs WHERE id=?").get(model.providerConfigId) as Record<string, unknown>;
    return providerConfigSchema.parse({ id: r.id, displayName: "Live test", providerType: r.provider_type,
      baseUrl: r.base_url, credentialRef: r.credential_ref, settings: null, enabled: true, createdAt: now, updatedAt: now });
  });
  db.close();
  const character = characterSchema.parse({ id: selected.id, name: "Live test", portraitAssetId: null,
    portraitFocusX: .5, portraitFocusY: 0, portraitZoom: 1,
  useDefaultSpeechModel: false, useDefaultSpeechVoice: false, modelConfigId: languageRow.id,
    speechModelConfigId: selected.speech, speechVoice: selected.voice, systemPrompt: "", createdAt: now, updatedAt: now });
  const database = {
    listProviderConfigs: () => ({ providerConfigs: providers }), listModelConfigs: () => ({ modelConfigs: models }),
    fetchProviderConfig: (id: string) => { const result = providers.find(p => p.id === id); assert.ok(result); return result; },
    fetchModelConfig: (id: string) => { const result = models.find(m => m.id === id); assert.ok(result); return result; },
    getAppSettings: () => emptyAppSettings,
    fetchCharacter: () => character,
  };
  const aiRuntime = await createAiRuntime({ database, credentialStore: {
    put: async () => { throw new Error("Read only"); }, delete: async () => { throw new Error("Read only"); },
    resolve: async reference => {
      assert.match(reference, /^safe-storage\/[a-f0-9-]{36}$/);
      return (await safeStorage.decryptStringAsync(await readFile(join(directory, "credentials", reference.split("/")[1] + ".bin")))).result;
    },
  } });
  const output = resolve(".test-dist/dialogue-speech-live"); await mkdir(output, { recursive: true });
  const speech = createSpeechService({ database, aiRuntime, cache: createTtsCache({ directory: join(output, "cache") }),
    artifactCache: createSpeechArtifactCache(join(output, "cache")), profileDirectory: join(directory, "speech-profiles") });
  let syntheses = 0, failures = 0, lastInput = "";
  avatar = new AvatarService(resolve("unity/KataruneAvatar/Builds/Windows/KataruneAvatar.exe"), output);
  avatar.configureSpeech({ generate: async (...args) => {
    syntheses++; lastInput = args[1]; try { return await speech.generate(...args); } catch (error) { failures++; throw error; }
  } }, output);
  const binding = { characterId: selected.id, threadId: randomUUID() };
  await avatar.start(binding);
  const controller = new AbortController();
  const result = streamText({ model: aiRuntime.resolveLanguageModel(languageRow.id),
    prompt: "只回复这句话，不要添加其他内容：你好，我们正在测试言奏的语音与口型同步。", abortSignal: controller.signal });
  let textEnds = 0;
  const stream = avatar.relay(binding, result.toUIMessageStream(), controller.signal);
  for await (const chunk of stream) if (chunk.type === "text-end") textEnds++;
  assert.ok(textEnds > 0 && syntheses > 0); assert.equal(failures, 0);
  assert.equal(avatar.status.busy, false);
  const cached = await speech.generate(selected.id, lastInput, new AbortController().signal, true);
  assert.equal(cached.cacheHit, true);
  assert.ok(cached.contentHash && cached.timingSource === "provider-segments");
  const cancelled = new AbortController();
  const source = new ReadableStream<UIMessageChunk>({ start(c) {
    c.enqueue({ type: "text-start", id: "cancel" });
    c.enqueue({ type: "text-delta", id: "cancel", delta: "这段未完成的文字不应合成。" });
  } });
  const reader = avatar.relay(binding, source, cancelled.signal).getReader();
  await reader.read(); await reader.read(); const before = syntheses;
  cancelled.abort(); await reader.cancel();
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.equal(syntheses, before); assert.equal(avatar.status.phase, "ready"); assert.equal(avatar.status.busy, false);
  console.log(JSON.stringify({ passed: true, nativeTextBlocks: textEnds, syntheses, cancellation: true, cacheHit: cached.cacheHit,
    calibratedProfile: !!cached.profilePath, provider: "real DeepSeek + Fish", database: "read-only" }));
  avatar.stop(); app.exit(0);
}).catch(() => { avatar?.stop(); console.error("Live dialogue integration failed; inspect the local Player log. No credential data is logged."); app.exit(1); });
