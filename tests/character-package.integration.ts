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
import { DEFAULT_PACKAGE_ID } from "../src/shared/characterPackages";
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
      },
    );
    let currentRequest = randomUUID();
    try {
      const oldPortrait = db.listCharacters().characters[0]!.portraitAssetId;
      await service.initialize();
      const builtin = service.detail(DEFAULT_PACKAGE_ID);
      assert.equal(builtin.customActions.length, 9);
      const builtinRuntime = service.runtime(DEFAULT_PACKAGE_ID);
      assert.equal(builtinRuntime.idle, join(images, "Motions/idle-standing-breathing.vrma"));
      assert.deepEqual(builtinRuntime.idleVariations, [
        join(images, "Motions/idle-variation-01.vrma"),
        join(images, "Motions/idle-variation-02.vrma"),
      ]);
      assert.equal(builtinRuntime.systemBehaviors?.length, 20);
      assert.equal(builtinRuntime.systemBehaviors?.find(a => a.name === "nod")?.playback.layer, "head");
      assert.equal(builtinRuntime.systemBehaviors?.find(a => a.name === "greet")?.playback.layer, "upperBody");
      assert.equal(builtinRuntime.systemBehaviors?.find(a => a.name === "think")?.playback.layer, "body");
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
      const portrait = await readFile(join(images, "default-package/portrait.png"));
      const makeZip = async (
        name: string,
        extra: Parameters<typeof packageZip>[0] = [],
        manifestBytes?: Buffer,
      ) => {
        const path = join(directory, `${name}.zip`);
        const manifest = {
          formatVersion: 2,
          name,
          version: "1.0.0",
          portrait: "portrait.png",
          model: "avatar.vrm",
          systemActions: {},
          customActions: [
            { name: "挥手", description: "问候", playback: { kind: "oneShot", file: "wave.vrma" } },
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
                '","version":"1","portrait":"portrait.png","model":"avatar.vrm","systemActions":{},"customActions":[{"name":"挥手","description":"问候","file":"wave.vrma"}]}',
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
      assert.equal(repeated.customActions[0]!.id, first.customActions[0]!.id);
      deletionDuringValidation = first.id;
      const second = await service.import(secondZip, randomUUID(), () => {});
      deletionDuringValidation = undefined;
      assert.notEqual(second.id, first.id);
      assert.notEqual(second.customActions[0]!.id, first.customActions[0]!.id);
      assert.equal(
        service.runtime(first.id).model,
        service.runtime(second.id).model,
      );
      assert.equal(
        service.runtime(first.id).customActions[0]!.file,
        service.runtime(second.id).customActions[0]!.file,
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
      const actionId = first.customActions[0]!.id;
      const v2Manifest = {
        formatVersion: 2, name: "循环测试包", version: "1.0.0", portrait: "portrait.png", model: "avatar.vrm",
        systemActions: { think: { kind: "loop", enter: "wave.vrma", loop: "loop.vrma", exit: "exit.vrma" } },
        customActions: [
          { key: "001", name: "问候", description: "打招呼", playback: { kind: "oneShot", file: "wave.vrma" } },
          { name: "抱臂", description: "保持姿态", playback: { kind: "loop", loop: "loop.vrma" } },
        ],
      };
      const v2 = await service.import(await makeZip("v2", [
        { name: "loop.vrma", data: "loop fixture validated by callback" },
        { name: "exit.vrma", data: "exit fixture validated by callback" },
      ], Buffer.from(JSON.stringify(v2Manifest))), randomUUID(), () => {});
      const v2Runtime = service.runtime(v2.id);
      assert.equal(v2Runtime.customActions[0]!.key, "001");
      assert.equal(v2Runtime.customActions[1]!.key, "抱臂");
      assert.equal(v2Runtime.systemBehaviors?.[0]?.id, "system.think");
      assert.equal(v2Runtime.systemBehaviors?.[0]?.playback.kind, "loop");
      assert.equal(v2Runtime.formatVersion, 2);
      assert.equal(v2Runtime.systemBehaviors?.[0]?.playback.blendSeconds, .2);
      const v2Id = v2.customActions[0]!.id;
      // A pre-release record remains untouched, but must not hide valid v2 choices.
      const oldId = randomUUID();
      const oldManifest = JSON.stringify({ ...first.manifest, formatVersion: 1 });
      const raw = new BetterSqlite3(join(directory, "katarune.sqlite"));
      try {
        raw.prepare("INSERT INTO character_packages (id, builtin, source_hash, manifest, portrait_asset_id, thumbnail_asset_id) SELECT ?, 0, NULL, ?, portrait_asset_id, thumbnail_asset_id FROM character_packages WHERE id = ?").run(oldId, oldManifest, first.id);
        assert.ok(!service.list().some(pack => pack.id === oldId));
        assert.ok(service.list().some(pack => pack.id === DEFAULT_PACKAGE_ID));
        assert.throws(() => db.fetchCharacterPackage(oldId), /v2.*重新导入/);
        assert.deepEqual(raw.prepare("SELECT manifest FROM character_packages WHERE id = ?").get(oldId), { manifest: oldManifest });
      } finally { raw.close(); }
      db.close();
      db = openDatabase(options);
      assert.equal(db.fetchCharacter(role.id).packageId, first.id);
      assert.equal(
        db.fetchCharacterPackage(first.id).customActions[0]!.id,
        actionId,
      );
      assert.equal(db.fetchCharacter(role.id).systemPrompt, "保留提示词");
      assert.equal(db.fetchCharacterPackage(v2.id).customActions[0]!.id, v2Id);
      assert.equal(db.fetchCharacterPackage(v2.id).customActions[0]!.key, "001");
      assert.equal(db.fetchCharacterPackage(v2.id).customActions[1]!.playback?.kind, "loop");
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
