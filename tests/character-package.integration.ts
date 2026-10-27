import { cameraGlb } from "./cameraGlbFixture.mjs";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, writeFile, rm, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { app } from "electron";
import BetterSqlite3 from "better-sqlite3";
import { openDatabase } from "../src/main/database/database";
import { createAssetService } from "../src/main/assets/assetService";
import { CharacterPackageService } from "../src/main/characters/characterPackageService";
import {
  validateModelMetadata,
  validateModelSettings,
  validateProviderSettings,
} from "../src/main/ai/providerDefinitions";
import { DEFAULT_PACKAGE_ID, type RuntimeCharacterPackage } from "../src/shared/characterPackages";
import { packageZip } from "./packageZip";

void app
  .whenReady()
  .then(async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "katarune-package-integration-"),
    );
    const options = {
      userDataPath: directory,
      appPath: process.cwd(),
      configValidator: {
        validateModelMetadata,
        validateModelSettings,
        validateProviderSettings,
      },
    };
    let db = openDatabase(options);
    const images = join(process.cwd(), "resources/characters");
    const assets = createAssetService({
      userDataPath: directory,
      characterResourcesPath: images,
    });
    let failValidation = false,
      cancelValidation = false;
    let validateAudio: ((pack: RuntimeCharacterPackage) => Promise<void>) | undefined;
    let deletionDuringValidation: string | undefined;
    const service = new CharacterPackageService(
      db,
      assets,
      directory,
      join(images, "default-package"),
      images,
      async (_pack, signal) => {
        if (deletionDuringValidation)
          assert.throws(
            () => service.remove(deletionDuringValidation!),
            /正在导入/,
          );
        if (failValidation) throw new Error("bad VRM fixture");
        if (cancelValidation) {
          service.cancel(currentRequest);
          signal.throwIfAborted();
        }
        await validateAudio?.(_pack);
      },
    );
    let currentRequest = randomUUID();
    try {
      const oldPortrait = db.listCharacters().characters[0]!.portraitAssetId;
      await service.initialize();
      const builtin = service.detail(DEFAULT_PACKAGE_ID);
      assert.equal(builtin.actions.length, 26);
      assert.equal(builtin.manifest.formatVersion, 3);
      const builtinRuntime = service.runtime(DEFAULT_PACKAGE_ID);
      assert.equal(builtinRuntime.actions.find(a => a.id === builtinRuntime.idle.base)?.playback.motion, join(images, "actions/idle/motion.vrma"));
      assert.deepEqual(builtinRuntime.idle.variations.map(id => builtinRuntime.actions.find(a => a.id === id)?.key), ["idle-variation-01", "idle-variation-02"]);
      assert.equal(builtinRuntime.bindings.length, 19);
      const builtinDance = builtinRuntime.actions.find(action => action.key === "sad-water");
      assert.ok(builtinDance?.playback.kind === "performance");
      assert.equal(builtinDance.playback.motion, join(images, "actions/sad-water/motion.vrma"));
      assert.equal(builtinDance.playback.audio, join(images, "actions/sad-water/audio.mp3"));
      assert.equal(builtinDance.playback.subtitles, join(images, "actions/sad-water/subtitles.srt"));
      assert.deepEqual(builtinDance.playback.camera, { kind: "track", file: join(images, "actions/sad-water/camera.glb"), referenceHeight: 1.7653304392347835 });
      const angelDance = builtinRuntime.actions.find(action => action.key === "redreaming-angel");
      assert.ok(angelDance?.playback.kind === "performance");
      assert.deepEqual(angelDance.playback.camera, { kind: "track", file: join(images, "actions/redreaming-angel/camera.glb"), referenceHeight: 1.6553590819239616 });
      assert.equal(angelDance.playback.audio, join(images, "actions/redreaming-angel/audio.wav"));
      assert.ok(!builtinRuntime.bindings.some(binding => binding.role === "thinkGesture"));
      assert.equal(builtinRuntime.actions.find(a => a.key === "nod")?.playback.layer, "head");
      assert.equal(builtinRuntime.actions.find(a => a.key === "greet")?.playback.layer, "upperBody");
      assert.equal(builtinRuntime.actions.find(a => a.key === "think")?.playback.layer, "body");
      // Existing installations must drop retired builtin actions without assigning
      // new identities to the retained variants on their next initialization.
      const installedBuiltin = db.fetchCharacterPackage(DEFAULT_PACKAGE_ID);
      const retired = { ...builtin.actions[0]!, id: randomUUID(), key: "retired-full", name: "旧全身版本" };
      db.registerCharacterPackage({
        id: installedBuiltin.id, builtin: true, sourceHash: null, manifest: installedBuiltin.manifest,
        portraitAssetId: installedBuiltin.portraitAssetId, thumbnailAssetId: installedBuiltin.thumbnailAssetId,
        resources: installedBuiltin.resources, newAssets: [], actions: [...builtin.actions, retired],
      });
      await service.initialize();
      assert.deepEqual(service.detail(DEFAULT_PACKAGE_ID).actions.map(action => action.id), builtin.actions.map(action => action.id));
      assert.ok(!service.detail(DEFAULT_PACKAGE_ID).actions.some(action => action.id === retired.id));
      assert.throws(() => service.remove(DEFAULT_PACKAGE_ID), /不可删除/);
      assert.ok(
        db
          .listCharacters()
          .characters.every(
            (c) =>
              c.packageId === DEFAULT_PACKAGE_ID &&
              c.packagePortraitAssetId === builtin.portraitAssetId,
          ),
      );
      assert.equal(
        db.listCharacters().characters[0]!.portraitAssetId,
        oldPortrait,
      );
      const portrait = await readFile(join(images, "default-package/avatar/portrait.png"));
      const makeZip = async (
        name: string,
        extra: Parameters<typeof packageZip>[0] = [],
        manifestBytes?: Buffer,
      ) => {
        const path = join(directory, `${name}.zip`);
        const manifest = {
          formatVersion: 3,
          name,
          version: "1.0.0",
          portrait: "portrait.png",
          model: "avatar.vrm",
          bindings: {},
          actions: [
            { key: "wave", name: "挥手", description: "问候", playback: { kind: "oneShot", motion: "wave.vrma" } },
          ],
        };
        await writeFile(
          path,
          packageZip([
            {
              name: "manifest.json",
              data: manifestBytes ?? JSON.stringify(manifest),
            },
            { name: "portrait.png", data: portrait },
            { name: "avatar.vrm", data: "model fixture validated by callback" },
            {
              name: "wave.vrma",
              data: "animation fixture validated by callback",
            },
            ...extra,
          ]),
        );
        return path;
      };
      await assert.rejects(
        service.import(
          await makeZip(
            "invalid-utf8",
            [],
            Buffer.concat([
              Buffer.from('{"formatVersion":1,"name":"'),
              Buffer.from([0x80]),
              Buffer.from(
                '","version":"1","portrait":"portrait.png","model":"avatar.vrm","systemActions":{},"actions":[{"name":"挥手","description":"问候","file":"wave.vrma"}]}',
              ),
            ]),
          ),
          randomUUID(),
          () => {},
        ),
        /encoded|encoding|UTF-8/i,
      );
      const firstZip = await makeZip("first"),
        secondZip = await makeZip("second");
      const first = await service.import(firstZip, randomUUID(), () => {});
      const repeated = await service.import(firstZip, randomUUID(), () => {});
      assert.equal(repeated.id, first.id);
      assert.equal(repeated.actions[0]!.id, first.actions[0]!.id);
      deletionDuringValidation = first.id;
      const second = await service.import(secondZip, randomUUID(), () => {});
      deletionDuringValidation = undefined;
      assert.notEqual(second.id, first.id);
      assert.notEqual(second.actions[0]!.id, first.actions[0]!.id);
      assert.equal(
        service.runtime(first.id).model,
        service.runtime(second.id).model,
      );
      assert.equal(
        service.runtime(first.id).actions[0]!.playback.motion,
        service.runtime(second.id).actions[0]!.playback.motion,
      );
      const role = db.createCharacter({
        name: "独立角色",
        modelConfigId: null,
        speechModelConfigId: null,
        speechVoice: null,
        systemPrompt: "保留提示词",
      });
      assert.equal(role.packageId, DEFAULT_PACKAGE_ID);
      db.bindCharacterPackage(role.id, first.id);
      assert.throws(() => service.remove(first.id), /先更换/);
      const before = service.list().length;
      failValidation = true;
      await assert.rejects(
        service.import(await makeZip("bad"), randomUUID(), () => {}),
        /bad VRM/,
      );
      failValidation = false;
      assert.equal(service.list().length, before);
      assert.equal(db.fetchCharacter(role.id).packageId, first.id);
      cancelValidation = true;
      currentRequest = randomUUID();
      await assert.rejects(
        service.import(await makeZip("cancel"), currentRequest, () => {}),
      );
      cancelValidation = false;
      assert.equal(service.list().length, before);
      assert.deepEqual(await readdir(join(directory, "package-staging")), []);
      await assert.rejects(
        service.import(
          await makeZip("extra", [{ name: "unreferenced.dll", data: "no" }]),
          randomUUID(),
          () => {},
        ),
        /额外/,
      );
      const actionId = first.actions[0]!.id;
      const v2Manifest = {
        formatVersion: 3, name: "循环测试包", version: "1.0.0", portrait: "portrait.png", model: "avatar.vrm",
        bindings: { think: "think" },
        actions: [
          { key: "001", name: "问候", description: "打招呼", playback: { kind: "oneShot", motion: "wave.vrma" } },
          { key: "hold-arms", name: "抱臂", description: "保持姿态", playback: { kind: "loop", motion: "loop.vrma" } },
          { key: "think", name: "思考", description: "思考姿态", playback: { kind: "loop", enter: "wave.vrma", motion: "loop.vrma", exit: "exit.vrma" } },
        ],
      };
      const v2 = await service.import(await makeZip("v2", [
        { name: "loop.vrma", data: "loop fixture validated by callback" },
        { name: "exit.vrma", data: "exit fixture validated by callback" },
      ], Buffer.from(JSON.stringify(v2Manifest))), randomUUID(), () => {});
      const v2Runtime = service.runtime(v2.id);
      assert.equal(v2Runtime.actions[0]!.key, "001");
      assert.equal(v2Runtime.actions[1]!.key, "hold-arms");
      assert.equal(v2Runtime.bindings[0]?.actionId, v2Runtime.actions.find(a => a.key === "think")?.id);
      assert.equal(v2Runtime.actions.find(a => a.key === "think")?.playback.kind, "loop");
      assert.equal(v2Runtime.formatVersion, 3);
      assert.equal(v2Runtime.actions.find(a => a.key === "think")?.playback.blendSeconds, .2);
      const v2Id = v2.actions[0]!.id;
      const music = Buffer.from("opaque MP3 fixture validated by the player callback");
      const danceManifest = {
        ...v2Manifest, name: "舞蹈测试包", bindings: {},
        actions: [{ key: "dance", name: "短舞", description: "合成测试素材", playback: {
          kind: "performance", motion: "wave.vrma", audio: "music.mp3", subtitles: "lyrics.srt", camera: { kind: "presets", keys: [{ at: 0, view: "center" }, { at: .5, view: "closeup" }] },
        } }],
      };
      const lyrics = "1\n00:00:00,100 --> 00:00:00,900\n合成字幕";
      let audioName = "music.mp3", expectedAudio = music, audioValidations = 0;
      validateAudio = async pack => {
        const playback = pack.actions[0]?.playback;
        assert.ok(playback?.kind === "performance" && playback.audio);
        assert.ok(playback.audio.endsWith(audioName), "the player must receive the staged original audio path");
        assert.deepEqual(await readFile(playback.audio), expectedAudio, "audio bytes must not be transcoded or rewritten");
        audioValidations++;
      };
      const danceMedia = [{ name: "music.mp3", data: music }, { name: "lyrics.srt", data: lyrics }];
      const danceZip = await makeZip("dance", danceMedia, Buffer.from(JSON.stringify(danceManifest)));
      const dance = await service.import(danceZip, randomUUID(), () => {});
      const repeatedDance = await service.import(danceZip, randomUUID(), () => {});
      assert.equal(repeatedDance.actions[0]!.id, dance.actions[0]!.id);
      assert.equal(audioValidations, 1, "successful imports require player validation; identical reimports reuse the validated package");
      const dancePlayback = service.runtime(dance.id).actions[0]!.playback;
      assert.equal(dancePlayback.kind, "performance");
      assert.ok(dancePlayback.kind === "performance");
      const musicResource = db.fetchCharacterPackage(dance.id).resources.find(resource => resource.path === "music.mp3");
      assert.ok(musicResource);
      assert.equal(dancePlayback.audio, assets.resolveManagedPath(musicResource.assetId));
      assert.deepEqual(dancePlayback.camera, danceManifest.actions[0]!.playback.camera);
      assert.equal(db.fetchAsset(musicResource.assetId).kind, "character_audio");
      assert.equal(db.fetchAsset(musicResource.assetId).mimeType, "audio/mpeg");
      const subtitleResource = db.fetchCharacterPackage(dance.id).resources.find(resource => resource.path === "lyrics.srt");
      assert.ok(subtitleResource);
      assert.equal(dancePlayback.subtitles, assets.resolveManagedPath(subtitleResource.assetId));
      assert.equal(db.fetchAsset(subtitleResource.assetId).kind, "character_subtitle");
      assert.equal(db.fetchAsset(subtitleResource.assetId).mimeType, "application/x-subrip");
      const musicPath = assets.resolveManagedPath(musicResource.assetId);
      const subtitlePath = assets.resolveManagedPath(subtitleResource.assetId);
      for (const name of ["music.custom", "music"]) {
        audioName = name;
        expectedAudio = Buffer.from(`opaque native audio fixture: ${name}`);
        const nativeManifest = { ...danceManifest, name, actions: danceManifest.actions.map(action => ({
          ...action, playback: { ...action.playback, audio: name },
        })) };
        const native = await service.import(await makeZip(`dance-${name}`, [{ name, data: expectedAudio }, { name: "lyrics.srt", data: lyrics }], Buffer.from(JSON.stringify(nativeManifest))), randomUUID(), () => {});
        const nativeResource = db.fetchCharacterPackage(native.id).resources.find(resource => resource.path === name);
        assert.ok(nativeResource);
        assert.equal(db.fetchAsset(nativeResource.assetId).mimeType, "application/octet-stream");
        service.remove(native.id);
        assert.equal(existsSync(assets.resolveManagedPath(nativeResource.assetId)), false);
        assert.equal(existsSync(subtitlePath), true, "removing a package must retain subtitles still used by another package");
      }
      assert.equal(audioValidations, 3, "unknown and absent extensions must both reach player validation");
      const danceCount = service.list().length;
      const existingAssetIds = db.listAssets().map(asset => asset.id).sort();
      await assert.rejects(service.import(await makeZip("dance-missing-audio", [], Buffer.from(JSON.stringify(danceManifest))), randomUUID(), () => {}), /资源不存在/);
      validateAudio = async pack => {
        const playback = pack.actions[0]?.playback;
        assert.ok(playback?.kind === "performance" && playback.audio);
        assert.equal(await readFile(playback.audio, "utf8"), "undecodable player fixture");
        throw new Error("player audio decode failed");
      };
      await assert.rejects(service.import(await makeZip("dance-bad-audio", [{ name: "music.mp3", data: "undecodable player fixture" }, { name: "lyrics.srt", data: lyrics }], Buffer.from(JSON.stringify(danceManifest))), randomUUID(), () => {}), /player audio decode failed/);
      await assert.rejects(service.import(await makeZip("dance-empty-audio", [{ name: "music.mp3", data: "" }, { name: "lyrics.srt", data: lyrics }], Buffer.from(JSON.stringify(danceManifest))), randomUUID(), () => {}), /资源大小/);
      await assert.rejects(service.import(await makeZip("dance-missing-subtitles", [{ name: "music.mp3", data: music }], Buffer.from(JSON.stringify(danceManifest))), randomUUID(), () => {}), /资源不存在/);
      await assert.rejects(service.import(await makeZip("dance-bad-subtitles", [{ name: "music.mp3", data: music }, { name: "lyrics.srt", data: "not timed subtitles" }], Buffer.from(JSON.stringify(danceManifest))), randomUUID(), () => {}), /字幕/);
      await assert.rejects(service.import(await makeZip("dance-invalid-subtitle-encoding", [{ name: "music.mp3", data: music }, { name: "lyrics.srt", data: Buffer.from([255]) }], Buffer.from(JSON.stringify(danceManifest))), randomUUID(), () => {}), /UTF-8/);
      assert.equal(service.list().length, danceCount, "failed music validation must not publish a partial package");
      assert.deepEqual(db.listAssets().map(asset => asset.id).sort(), existingAssetIds, "failed decoding must preserve existing asset records");
      assert.deepEqual(await readFile(musicPath), music, "failed decoding must preserve existing music bytes");
      assert.deepEqual(await readdir(join(directory, "package-staging")), [], "failed decoding must clear staged resources");
      validateAudio = undefined;
      const cameraData = cameraGlb();
      const cameraManifest = { ...v2Manifest, name: "镜头测试包", bindings: {}, actions: [{ key: "track", name: "镜头舞蹈", description: "合成镜头", playback: { kind: "performance", motion: "wave.vrma", camera: { kind: "track", file: "camera.glb", shots: [{ at: 0, node: "MainCamera" }] } } }] };
      const cameraZip = await makeZip("camera", [{ name: "camera.glb", data: cameraData }], Buffer.from(JSON.stringify(cameraManifest)));
      const cameraPackage = await service.import(cameraZip, randomUUID(), () => {});
      const cameraResource = db.fetchCharacterPackage(cameraPackage.id).resources.find(resource => resource.path === "camera.glb");
      assert.ok(cameraResource);
      const cameraPath = assets.resolveManagedPath(cameraResource.assetId);
      assert.equal(db.fetchAsset(cameraResource.assetId).kind, "character_camera");
      assert.equal(db.fetchAsset(cameraResource.assetId).mimeType, "model/gltf-binary");
      const cameraPlayback = service.runtime(cameraPackage.id).actions[0]!.playback;
      assert.ok(cameraPlayback.kind === "performance");
      assert.deepEqual(cameraPlayback.camera, { kind: "track", file: cameraPath, shots: [{ at: 0, node: "MainCamera" }] });
      assert.deepEqual(await readFile(cameraPath), cameraData);
      for (const data of [Buffer.from("{}"), cameraData.subarray(0, 80), cameraGlb({ mutate: document => { document.buffers[0]!.uri = "external.bin"; } })])
        await assert.rejects(service.import(await makeZip("invalid-camera", [{ name: "camera.glb", data }], Buffer.from(JSON.stringify(cameraManifest))), randomUUID(), () => {}));
      await assert.rejects(service.import(await makeZip("missing-camera", [], Buffer.from(JSON.stringify(cameraManifest))), randomUUID(), () => {}), /资源不存在/);
      assert.deepEqual(await readFile(cameraPath), cameraData, "failed camera imports preserve the installed resource");
      service.remove(cameraPackage.id);
      assert.equal(existsSync(cameraPath), false);
      service.remove(dance.id);
      assert.equal(existsSync(musicPath), false, "unreferenced package music must be released with the package");
      assert.equal(existsSync(subtitlePath), false, "unreferenced package subtitles must be released with the package");
      // A pre-release record remains untouched, but must not hide valid v2 choices.
      const oldId = randomUUID();
      const oldManifest = JSON.stringify({ ...first.manifest, formatVersion: 1 });
      const raw = new BetterSqlite3(join(directory, "katarune.sqlite"));
      try {
        raw.prepare("INSERT INTO character_packages (id, builtin, source_hash, manifest, portrait_asset_id, thumbnail_asset_id) SELECT ?, 0, NULL, ?, portrait_asset_id, thumbnail_asset_id FROM character_packages WHERE id = ?").run(oldId, oldManifest, first.id);
        assert.ok(!service.list().some(pack => pack.id === oldId));
        assert.ok(service.list().some(pack => pack.id === DEFAULT_PACKAGE_ID));
        assert.throws(() => db.fetchCharacterPackage(oldId), /v3.*重新导入/);
        assert.deepEqual(raw.prepare("SELECT manifest FROM character_packages WHERE id = ?").get(oldId), { manifest: oldManifest });
      } finally { raw.close(); }
      db.close();
      db = openDatabase(options);
      assert.equal(db.fetchCharacter(role.id).packageId, first.id);
      assert.equal(
        db.fetchCharacterPackage(first.id).actions[0]!.id,
        actionId,
      );
      assert.equal(db.fetchCharacter(role.id).systemPrompt, "保留提示词");
      assert.equal(db.fetchCharacterPackage(v2.id).actions[0]!.id, v2Id);
      assert.equal(db.fetchCharacterPackage(v2.id).actions[0]!.key, "001");
      assert.equal(db.fetchCharacterPackage(v2.id).actions[1]!.playback?.kind, "loop");
      db.deleteCharacterPackage(v2.id);
      const sharedModel = assets.resolveManagedPath(
        db
          .fetchCharacterPackage(first.id)
          .resources.find((r) => r.path === "avatar.vrm")!.assetId,
      );
      db.bindCharacterPackage(role.id, DEFAULT_PACKAGE_ID);
      assert.deepEqual(db.deleteCharacterPackage(first.id), []);
      assert.ok(existsSync(sharedModel));
      for (const id of db.deleteCharacterPackage(second.id))
        assets.removeExact(id);
      assert.equal(existsSync(sharedModel), false);
      assert.equal(db.fetchCharacter(role.id).name, "独立角色");
      console.log(
        "Character package: migration, builtin offline images, repeat IDs, deduplication, reference deletion, rollback and cancellation passed.",
      );
    } finally {
      db.close();
      await rm(directory, { recursive: true, force: true });
      app.quit();
    }
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
