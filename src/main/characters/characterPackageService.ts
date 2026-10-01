import { randomUUID } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { readFileSync, copyFileSync } from "node:fs";
import { join, extname, basename } from "node:path";
import { nativeImage } from "electron";
import {
  DEFAULT_PACKAGE_ID,
  characterPackageManifestSchema,
  type CharacterPackage,
  type RuntimeCharacterPackage,
  type PackageProgress,
} from "../../shared/characterPackages";
import type { AssetService } from "../assets/assetService";
import type {
  DatabaseRuntime,
  ReadyAssetRegistration,
} from "../database/types";
import type { StoredCharacterPackage } from "../database/characterPackageRepository";
import {
  extractPackage,
  hashFile,
  parsePackageManifest,
  readImageHeader,
} from "./packageArchive";

export class CharacterPackageService {
  private readonly jobs = new Map<string, AbortController>();
  private importing = false;
  private readonly leases = new Map<string, number>();
  retain(id: string): () => void {
    this.detail(id);
    this.leases.set(id, (this.leases.get(id) ?? 0) + 1);
    return () => {
      const count = (this.leases.get(id) ?? 1) - 1;
      if (count) this.leases.set(id, count);
      else this.leases.delete(id);
    };
  }
  constructor(
    private readonly db: DatabaseRuntime,
    private readonly assets: AssetService,
    private readonly userData: string,
    private readonly builtinResources: string,
    private readonly runtimeResources: string,
    private readonly validate: (
      pack: RuntimeCharacterPackage,
      signal: AbortSignal,
    ) => Promise<void>,
  ) {}

  async initialize(): Promise<void> {
    const manifest = characterPackageManifestSchema.parse(
      JSON.parse(
        readFileSync(join(this.builtinResources, "manifest.json"), "utf8"),
      ),
    );
    const ids = JSON.parse(
      readFileSync(join(this.builtinResources, "action-ids.json"), "utf8"),
    ) as string[];
    if (
      ids.length !== manifest.customActions.length ||
      new Set(ids).size !== ids.length
    )
      throw new Error("默认包动作 ID 清单无效。");
    const newAssets: ReadyAssetRegistration[] = [];
    const resources: { path: string; assetId: string }[] = [];
    for (const path of [manifest.portrait, manifest.thumbnail]) {
      if (!path) continue;
      const source = join(this.builtinResources, path);
      const bytes = readFileSync(source);
      const sha256 = await hashFile(source, new AbortController().signal);
      // A changed builtin image gets a new URL; historical portrait files remain immutable.
      const id = `${sha256.slice(0, 8)}-${sha256.slice(8, 12)}-4${sha256.slice(13, 16)}-8${sha256.slice(17, 20)}-${sha256.slice(20, 32)}`;
      const mimeType = readImageHeader(bytes).mime;
      copyFileSync(source, this.assets.resolveManagedPath(id));
      resources.push({ path, assetId: id });
      if (!newAssets.some((a) => a.id === id))
        newAssets.push({
          id,
          kind: "character_portrait",
          storageKey: id,
          mimeType,
          byteSize: bytes.length,
          sha256,
          originalName: basename(path),
        });
    }
    this.db.registerCharacterPackage({
      id: DEFAULT_PACKAGE_ID,
      builtin: true,
      sourceHash: null,
      manifest,
      portraitAssetId: resources[0]!.assetId,
      thumbnailAssetId: resources[1]?.assetId ?? null,
      resources,
      newAssets,
      customActions: manifest.customActions.map((a, i) => ({
        ...a,
        id: ids[i]!,
      })),
    });
    await mkdir(join(this.userData, "package-staging"), { recursive: true });
  }
  list(): CharacterPackage[] {
    return this.db.listCharacterPackages();
  }
  detail(id: string): CharacterPackage {
    const {
      resources: _r,
      sourceHash: _s,
      ...info
    } = this.db.fetchCharacterPackage(id);
    return info;
  }
  cancel(requestId: string): void {
    this.jobs.get(requestId)?.abort(new Error("导入已取消。"));
  }
  dispose(): void {
    for (const job of this.jobs.values()) job.abort();
  }
  remove(id: string): void {
    if (this.importing) throw new Error("正在导入角色包，请稍后删除。");
    if (this.leases.has(id)) throw new Error("角色包正在切换，请稍候再删除。");
    for (const assetId of this.db.deleteCharacterPackage(id))
      this.assets.removeExact(assetId);
  }
  runtime(id: string): RuntimeCharacterPackage {
    const pack = this.db.fetchCharacterPackage(id);
    const fallback = this.db.fetchCharacterPackage(DEFAULT_PACKAGE_ID);
    const resolve = (owner: StoredCharacterPackage, path: string): string => {
      if (owner.builtin) return join(this.runtimeResources, path);
      const resource = owner.resources.find((r) => r.path === path);
      if (!resource) throw new Error("角色包资源引用已损坏。");
      return this.assets.resolveManagedPath(resource.assetId);
    };
    return this.descriptor(
      pack,
      (path) => resolve(pack, path),
      (path) => resolve(fallback, path),
    );
  }
  private descriptor(
    pack: Pick<StoredCharacterPackage, "id" | "manifest" | "customActions">,
    resolve: (path: string) => string,
    fallback: (path: string) => string,
  ): RuntimeCharacterPackage {
    const defaults =
      this.db.fetchCharacterPackage(DEFAULT_PACKAGE_ID).manifest.systemActions;
    return {
      id: pack.id,
      version: pack.manifest.version,
      model: resolve(pack.manifest.model),
      idle: pack.manifest.systemActions.idle
        ? resolve(pack.manifest.systemActions.idle.file)
        : defaults.idle
          ? fallback(defaults.idle.file)
          : "",
      idleVariations:
        pack.manifest.systemActions.idle_variations?.map((a) =>
          resolve(a.file),
        ) ??
        defaults.idle_variations?.map((a) => fallback(a.file)) ??
        [],
      customActions: pack.customActions.map((a) => ({
        ...a,
        file: resolve(a.file),
      })),
    };
  }
  async import(
    path: string,
    requestId: string,
    progress: (value: PackageProgress) => void,
  ): Promise<CharacterPackage> {
    if (this.importing) throw new Error("另一个角色包正在导入，请等待完成。");
    this.importing = true;
    const controller = new AbortController();
    this.jobs.set(requestId, controller);
    const signal = controller.signal;
    let stage: string | undefined;
    const copied: string[] = [];
    try {
      if ((await stat(path)).size > 1024 ** 3)
        throw new Error("ZIP 超过 1 GiB。");
      const sourceHash = await hashFile(path, signal);
      const installed = this.db.findCharacterPackageByHash(sourceHash);
      if (installed) return this.detail(installed.id);
      stage = await mkdtemp(join(this.userData, "package-staging", "import-"));
      const files = await extractPackage(path, stage, signal, (files) =>
        progress({ requestId, phase: "extracting", files }),
      );
      const manifestPath = join(stage, "manifest.json");
      if ((await stat(manifestPath)).size > 1024 ** 2)
        throw new Error("清单超过 1 MiB。");
      const manifest = parsePackageManifest(
        new TextDecoder("utf-8", { fatal: true }).decode(
          await readFile(manifestPath),
        ),
      );
      const references = new Map<
        string,
        "character_portrait" | "character_vrm" | "character_animation"
      >();
      const add = (
        path: string,
        kind: "character_portrait" | "character_vrm" | "character_animation",
      ) => {
        if (references.has(path) && references.get(path) !== kind)
          throw new Error("同一文件不能用作不同资源类型。");
        references.set(path, kind);
      };
      add(manifest.portrait, "character_portrait");
      if (manifest.thumbnail) add(manifest.thumbnail, "character_portrait");
      add(manifest.model, "character_vrm");
      if (manifest.systemActions.idle)
        add(manifest.systemActions.idle.file, "character_animation");
      for (const a of [
        ...(manifest.systemActions.idle_variations ?? []),
        ...manifest.customActions,
      ])
        add(a.file, "character_animation");
      const allowed = new Set([
        "manifest.json",
        "LICENSE.txt",
        "CREDITS.txt",
        ...references.keys(),
      ]);
      if (files.some((f) => !allowed.has(f)))
        throw new Error("角色包包含清单未引用的额外文件。");
      for (const file of ["LICENSE.txt", "CREDITS.txt"]) {
        if (!files.includes(file)) continue;
        const path = join(stage, file);
        if ((await stat(path)).size > 1024 ** 2)
          throw new Error("说明文件超过 1 MiB。");
        new TextDecoder("utf-8", { fatal: true }).decode(await readFile(path));
      }
      const existing = this.db.listAssets();
      const newAssets: ReadyAssetRegistration[] = [];
      const resourceRows: { path: string; assetId: string }[] = [];
      for (const [file, kind] of references) {
        signal.throwIfAborted();
        if (!files.includes(file)) throw new Error(`资源不存在：${file}`);
        const source = join(stage, file);
        const size = (await stat(source)).size;
        if (
          size === 0 ||
          size >
            (kind === "character_portrait"
              ? 25
              : kind === "character_vrm"
                ? 512
                : 128) *
              1024 ** 2
        )
          throw new Error(`资源大小不符合限制：${file}`);
        const extension = extname(file).toLowerCase();
        let mimeType = "model/gltf-binary";
        if (kind === "character_portrait") {
          const bytes = await readFile(source);
          const header = readImageHeader(bytes);
          if (
            header.width < 1 ||
            header.height < 1 ||
            header.width > 4096 ||
            header.height > 4096
          )
            throw new Error("图片宽高必须不超过 4096。");
          if (
            !(
              {
                ".png": "image/png",
                ".jpg": "image/jpeg",
                ".jpeg": "image/jpeg",
                ".webp": "image/webp",
              } as Record<string, string>
            )[extension] ||
            (
              {
                ".png": "image/png",
                ".jpg": "image/jpeg",
                ".jpeg": "image/jpeg",
                ".webp": "image/webp",
              } as Record<string, string>
            )[extension] !== header.mime
          )
            throw new Error("图片格式不匹配或无法解码。");
          const decoded = nativeImage.createFromBuffer(bytes);
          const dimensions = decoded.getSize();
          if (
            decoded.isEmpty() ||
            dimensions.width < 1 ||
            dimensions.height < 1 ||
            dimensions.width > 4096 ||
            dimensions.height > 4096
          )
            throw new Error("图片无法解码或宽高超过 4096。");
          mimeType = header.mime;
        } else if (extension !== (kind === "character_vrm" ? ".vrm" : ".vrma"))
          throw new Error("模型或动画扩展名不支持。");
        const sha256 = await hashFile(source, signal);
        let shared: { id: string } | undefined = newAssets.find(
          (a) => a.kind === kind && a.sha256 === sha256,
        );
        if (!shared) {
          for (const candidate of existing.filter(
            (a) =>
              a.status === "ready" && a.kind === kind && a.sha256 === sha256,
          )) {
            if (
              (await hashFile(
                this.assets.resolveManagedPath(candidate.id),
                signal,
              ).catch(() => null)) === sha256
            ) {
              shared = candidate;
              break;
            }
          }
        }
        const id = shared?.id ?? randomUUID();
        if (!shared)
          newAssets.push({
            id,
            storageKey: id,
            kind,
            mimeType,
            byteSize: size,
            sha256,
            originalName: basename(file),
          });
        resourceRows.push({ path: file, assetId: id });
      }
      const id = randomUUID();
      const customActions = manifest.customActions.map((a) => ({
        ...a,
        id: randomUUID(),
      }));
      progress({ requestId, phase: "validating", files: files.length });
      await this.validate(
        this.descriptor(
          { id, manifest, customActions },
          (file) => join(stage!, file),
          (file) => join(this.runtimeResources, file),
        ),
        signal,
      );
      signal.throwIfAborted();
      progress({ requestId, phase: "publishing", files: files.length });
      for (const asset of newAssets) {
        const file = resourceRows.find((r) => r.assetId === asset.id)!;
        copied.push(asset.id);
        await copyFile(
          join(stage, file.path),
          this.assets.resolveManagedPath(asset.id),
        );
      }
      signal.throwIfAborted();
      this.db.registerCharacterPackage({
        id,
        builtin: false,
        sourceHash,
        manifest,
        resources: resourceRows,
        newAssets,
        customActions,
        portraitAssetId: resourceRows.find((r) => r.path === manifest.portrait)!
          .assetId,
        thumbnailAssetId: manifest.thumbnail
          ? resourceRows.find((r) => r.path === manifest.thumbnail)!.assetId
          : null,
      });
      copied.length = 0;
      return this.detail(id);
    } finally {
      for (const id of copied) this.assets.removeExact(id);
      if (stage) await rm(stage, { recursive: true, force: true });
      this.jobs.delete(requestId);
      this.importing = false;
    }
  }
}
