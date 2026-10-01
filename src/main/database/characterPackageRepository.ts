import { count, eq, and, notExists } from "drizzle-orm";
import {
  characterPackageSchema,
  DEFAULT_PACKAGE_ID,
  type CharacterPackage,
  type CharacterPackageManifest,
} from "../../shared/characterPackages";
import {
  assets,
  characters,
  characterPackages,
  packageResources,
  packageActions,
  messageAssets,
} from "./schema";
import type { KataruneDatabase, ReadyAssetRegistration } from "./types";

export interface StoredCharacterPackage extends CharacterPackage {
  sourceHash: string | null;
  resources: { path: string; assetId: string }[];
}
export interface PackageRegistration {
  id: string;
  builtin: boolean;
  sourceHash: string | null;
  manifest: CharacterPackageManifest;
  portraitAssetId: string;
  thumbnailAssetId: string | null;
  resources: { path: string; assetId: string }[];
  customActions: CharacterPackage["customActions"];
  newAssets: ReadyAssetRegistration[];
}
export function createCharacterPackageRepository(db: KataruneDatabase) {
  const fetchCharacterPackage = (id: string): StoredCharacterPackage => {
    const row = db
      .select()
      .from(characterPackages)
      .where(eq(characterPackages.id, id))
      .get();
    if (!row || !row.portraitAssetId)
      throw new Error("角色包不存在或尚未准备完成。");
    const actions = db
      .select()
      .from(packageActions)
      .where(eq(packageActions.packageId, id))
      .all();
    return {
      ...characterPackageSchema.parse({
        id: row.id,
        builtin: row.builtin,
        manifest: row.manifest,
        portraitAssetId: row.portraitAssetId,
        thumbnailAssetId: row.thumbnailAssetId,
        customActions: actions.map(({ packageId: _p, ...a }) => a),
        referenceCount:
          db
            .select({ n: count() })
            .from(characters)
            .where(eq(characters.packageId, id))
            .get()?.n ?? 0,
      }),
      sourceHash: row.sourceHash,
      resources: db
        .select({
          path: packageResources.path,
          assetId: packageResources.assetId,
        })
        .from(packageResources)
        .where(eq(packageResources.packageId, id))
        .all(),
    };
  };
  return {
    fetchCharacterPackage,
    listCharacterPackages: (): CharacterPackage[] =>
      db
        .select({ id: characterPackages.id })
        .from(characterPackages)
        .all()
        .filter(
          (row) =>
            db
              .select({ portrait: characterPackages.portraitAssetId })
              .from(characterPackages)
              .where(eq(characterPackages.id, row.id))
              .get()?.portrait,
        )
        .map((row) => {
          const {
            sourceHash: _h,
            resources: _r,
            ...info
          } = fetchCharacterPackage(row.id);
          return info;
        }),
    findCharacterPackageByHash: (
      hash: string,
    ): StoredCharacterPackage | null => {
      const row = db
        .select({ id: characterPackages.id })
        .from(characterPackages)
        .where(eq(characterPackages.sourceHash, hash))
        .get();
      return row ? fetchCharacterPackage(row.id) : null;
    },
    registerCharacterPackage: (
      registration: PackageRegistration,
    ): StoredCharacterPackage => {
      db.transaction((tx) => {
        const now = new Date();
        for (const asset of registration.newAssets)
          tx.insert(assets)
            .values({
              ...asset,
              status: "ready",
              createdAt: now,
              updatedAt: now,
            })
            .onConflictDoUpdate({
              target: assets.id,
              set: { ...asset, status: "ready", updatedAt: now },
            })
            .run();
        const {
          resources,
          customActions,
          newAssets: _a,
          ...row
        } = registration;
        tx.insert(characterPackages)
          .values(row)
          .onConflictDoUpdate({ target: characterPackages.id, set: row })
          .run();
        tx.delete(packageResources)
          .where(eq(packageResources.packageId, row.id))
          .run();
        tx.delete(packageActions)
          .where(eq(packageActions.packageId, row.id))
          .run();
        for (const resource of resources)
          tx.insert(packageResources)
            .values({ ...resource, packageId: row.id })
            .run();
        for (const action of customActions)
          tx.insert(packageActions)
            .values({ ...action, packageId: row.id })
            .run();
      });
      return fetchCharacterPackage(registration.id);
    },
    bindCharacterPackage: (characterId: string, packageId: string): void => {
      fetchCharacterPackage(packageId);
      if (
        db
          .update(characters)
          .set({ packageId, updatedAt: new Date() })
          .where(eq(characters.id, characterId))
          .run().changes !== 1
      )
        throw new Error("角色不存在。");
    },
    deleteCharacterPackage: (id: string): string[] =>
      db.transaction((tx) => {
        const pack = fetchCharacterPackage(id);
        if (id === DEFAULT_PACKAGE_ID || pack.builtin)
          throw new Error("默认角色包不可删除。");
        if (pack.referenceCount > 0)
          throw new Error("角色包正在被角色使用，请先更换角色包。");
        const candidates = [...new Set(pack.resources.map((r) => r.assetId))];
        tx.delete(characterPackages).where(eq(characterPackages.id, id)).run();
        const removed: string[] = [];
        for (const id of candidates) {
          const result = tx
            .delete(assets)
            .where(
              and(
                eq(assets.id, id),
                notExists(
                  tx
                    .select()
                    .from(packageResources)
                    .where(eq(packageResources.assetId, assets.id)),
                ),
                notExists(
                  tx
                    .select()
                    .from(characters)
                    .where(eq(characters.portraitAssetId, assets.id)),
                ),
                notExists(
                  tx
                    .select()
                    .from(messageAssets)
                    .where(eq(messageAssets.assetId, assets.id)),
                ),
                notExists(
                  tx
                    .select()
                    .from(characterPackages)
                    .where(eq(characterPackages.portraitAssetId, assets.id)),
                ),
                notExists(
                  tx
                    .select()
                    .from(characterPackages)
                    .where(eq(characterPackages.thumbnailAssetId, assets.id)),
                ),
              ),
            )
            .run();
          if (result.changes) removed.push(id);
        }
        return removed;
      }),
  };
}
