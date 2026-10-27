import { mkdtemp, rm, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  extractPackage,
  parsePackageManifest,
  readImageHeader,
  validatePackageSrt,
  validateCameraGlb,
} from "../src/main/characters/packageArchive";
import { isPackagePath, packageAnimationFiles, packageAudioFiles, packageSubtitleFiles, packageCameraFiles, primaryPlaybackFile } from "../src/shared/characterPackages";
import { packageZip } from "./packageZip";

const manifest = {
  formatVersion: 3,
  name: "测试包",
  version: "1.0.0",
  portrait: "portrait.png",
  model: "avatar.vrm",
  actions: [],
};
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});
async function extract(
  entries: Parameters<typeof packageZip>[0],
  signal = new AbortController().signal,
  progress = (_files: number) => {},
) {
  const directory = await mkdtemp(join(tmpdir(), "katarune-package-test-"));
  directories.push(directory);
  const archive = join(directory, "pack.zip"),
    target = join(directory, "stage");
  await writeFile(archive, packageZip(entries));
  return extractPackage(archive, target, signal, progress);
}
describe("character package import boundary", () => {
  const action = (key: string, kind = "oneShot", extra = {}) => ({ key, name: key, description: "测试动作", playback: { kind, motion: `${key}.vrma`, ...extra } });
  it("uses one catalog for idle, bindings and actions, with stable keys independent of labels", () => {
    const pack = parsePackageManifest(JSON.stringify({ ...manifest,
      actions: [action("idle", "loop"), action("shift"), action("wave"), action("think", "loop", { enter: "enter.vrma", exit: "exit.vrma" })],
      idle: { base: "idle", variations: ["shift"] }, bindings: { greet: "wave", think: "think", nod: "wave" },
    }));
    expect(pack.bindings?.greet).toBe("wave");
    expect(packageAnimationFiles(pack)).toEqual(["idle.vrma", "shift.vrma", "wave.vrma", "think.vrma", "enter.vrma", "exit.vrma"]);
    expect(() => parsePackageManifest(JSON.stringify({ ...pack, actions: pack.actions.map(a => ({ ...a, name: "同名显示名称" })) }))).not.toThrow();
  });
  it("rejects dangling, duplicate and incompatible references", () => {
    const actions = [action("idle", "loop"), action("wave"), action("show", "performance")];
    for (const extra of [
      { idle: { base: "missing" } }, { idle: { base: "wave" } }, { idle: { variations: ["idle"] } },
      { idle: { variations: ["wave", "wave"] } }, { bindings: { greet: "missing" } },
      { bindings: { greet: "show" } }, { bindings: { unknown: "wave" } }, { actions: [actions[0], actions[0]] },
      { actions: [action("UpperCase")] }, { actions: [action("wave"), { ...action("wave"), key: undefined }] },
      { actions: [action("wave", "loop", { enter: "../enter.vrma" })] },
      { actions: [action("wave", "oneShot", { exit: "exit.vrma" })] },
      { actions: [action("idle", "loop", { enter: "enter.vrma" })], idle: { base: "idle" } },
      { actions: [action("wave", "oneShot", { layer: "head" })], idle: { variations: ["wave"] } },
    ]) expect(() => parsePackageManifest(JSON.stringify({ ...manifest, actions, ...extra }))).toThrow();
  });
  it("collects motion, audio, subtitles and tagged camera resources", () => {
    const show = action("show", "performance", { audio: "music.wav", subtitles: "lyrics.srt", camera: { kind: "track", file: "camera.glb" } });
    const pack = parsePackageManifest(JSON.stringify({ ...manifest, actions: [show] }));
    expect(packageAnimationFiles(pack)).toEqual(["show.vrma"]);
    expect(packageAudioFiles(pack)).toEqual(["music.wav"]);
    expect(packageSubtitleFiles(pack)).toEqual(["lyrics.srt"]);
    expect(packageCameraFiles(pack)).toEqual(["camera.glb"]);
    expect(primaryPlaybackFile(pack.actions[0]!.playback)).toBe("show.vrma");
    for (const extra of [{ layer: "head" }, { blending: "additive" }, { reference: "ref.vrma" }, { audio: "../music.wav" },
      { cameraTrack: "camera.glb" }, { camera: { kind: "track", file: "camera.glb", keys: [] } },
      { camera: { kind: "presets", keys: [] } }, { camera: { kind: "presets", keys: [{ at: 1, view: "center" }, { at: 0, view: "closeup" }] } },
    ]) expect(() => parsePackageManifest(JSON.stringify({ ...manifest, actions: [{ ...show, playback: { ...show.playback, ...extra } }] }))).toThrow();
    expect(() => parsePackageManifest(JSON.stringify({ ...manifest, actions: [action("show", "performance", { camera: { kind: "presets", keys: [{ at: 0, view: "center" }] } })] }))).not.toThrow();
  });
  it("validates additive references and rejects incompatible layers", () => {
    const pack = parsePackageManifest(JSON.stringify({ ...manifest, actions: [action("nod", "oneShot", { layer: "head", reference: "neutral.vrma" })] }));
    expect(packageAnimationFiles(pack)).toEqual(["nod.vrma", "neutral.vrma"]);
    for (const extra of [{ layer: "body", blending: "additive" }, { layer: "upperBody", reference: "neutral.vrma" }, { layer: "head", reference: "../outside.vrma" }, { layer: "hands" }])
      expect(() => parsePackageManifest(JSON.stringify({ ...manifest, actions: [action("nod", "oneShot", extra)] }))).toThrow();
  });
  it("validates GLB framing and rejects external resources and damaged containers", async () => {
    const { cameraGlb } = await import("./cameraGlbFixture.mjs");
    expect(() => validateCameraGlb(cameraGlb())).not.toThrow();
    for (const bytes of [Buffer.from("{}"), cameraGlb().subarray(0, 80),
      cameraGlb({ mutate: document => { document.buffers[0]!.uri = "outside.bin"; } }),
      cameraGlb({ mutate: document => { document.cameras = []; } }),
    ]) expect(() => validateCameraGlb(bytes)).toThrow();
    const camera = { kind: "track", file: "camera.glb", referenceHeight: 1.6, animation: "Camera", shots: [{ at: 0, node: "MainCamera" }, { at: 2, node: "OrthoCamera" }] };
    expect(() => parsePackageManifest(JSON.stringify({ ...manifest, actions: [action("show", "performance", { camera })] }))).not.toThrow();
    for (const extra of [{ referenceHeight: 0 }, { shots: [] }, { shots: [{ at: 1, node: "Camera" }] }, { shots: [{ at: 0, node: "Camera" }, { at: 0, node: "Other" }] }])
      expect(() => parsePackageManifest(JSON.stringify({ ...manifest, actions: [action("show", "performance", { camera: { ...camera, ...extra } })] }))).toThrow();
  });
  it.each([1, 2])("rejects obsolete manifest version %s without rewriting data", version => {
    expect(() => parsePackageManifest(JSON.stringify({ ...manifest, formatVersion: version }))).toThrow();
  });
  it("accepts an empty catalog and Unicode resource paths", () => {
    expect(parsePackageManifest(JSON.stringify(manifest)).actions).toEqual([]);
    expect(isPackagePath("动作/招手.vrma")).toBe(true);
  });
  it("rejects duplicated escaped keys, unknown fields and author supplied IDs", () => {
    expect(() =>
      parsePackageManifest(
        JSON.stringify(manifest).replace(
          '"name":"测试包"',
          '"name":"测试包","na\\u006de":"替换"',
        ),
      ),
    ).toThrow(/重复/);
    expect(() =>
      parsePackageManifest(
        JSON.stringify({ ...manifest, packageId: "builtin:default" }),
      ),
    ).toThrow();
    expect(() =>
      parsePackageManifest(
        JSON.stringify({
          ...manifest,
          systemActions: { wave: { file: "wave.vrma" } },
        }),
      ),
    ).toThrow();
  });
  it.each([
    "../outside.png",
    "/absolute.png",
    "C:/file",
    "a\\b",
    "a//b",
    "NUL.png",
    "a./b",
    "a /b",
    "a:b",
    "https://site/image",
    "a/../b",
  ])("rejects unsafe path %s", (path) =>
    expect(isPackagePath(path)).toBe(false),
  );
  it("extracts safe resources and reports actual files", async () => {
    const progress: number[] = [];
    expect(
      await extract(
        [
          { name: "manifest.json", data: JSON.stringify(manifest) },
          { name: "动作/挥手.vrma", data: "test" },
        ],
        undefined,
        (n) => progress.push(n),
      ),
    ).toEqual(["manifest.json", "动作/挥手.vrma"]);
    expect(progress).toEqual([1, 2]);
  });
  it.each(["../outside.txt", "C:/outside.txt", "a\\b"])(
    "does not extract traversal %s",
    async (name) => {
      await expect(extract([{ name, data: "x" }])).rejects.toThrow();
      expect(await readdir(directories.at(-1)!)).toEqual(["pack.zip"]);
    },
  );
  it("rejects case insensitive duplicates and symlinks", async () => {
    await expect(
      extract([
        { name: "a.png", data: "x" },
        { name: "A.png", data: "y" },
      ]),
    ).rejects.toThrow(/重复/);
    await expect(
      extract([{ name: "link", data: "../other", mode: 0xa000 }]),
    ).rejects.toThrow(/链接/);
  });
  it("rejects implicit directory and file conflicts in either order", async () => {
    await expect(
      extract([
        { name: "Dir/file", data: "x" },
        { name: "dir", data: "y" },
      ]),
    ).rejects.toThrow(/冲突/);
    await expect(
      extract([
        { name: "dir", data: "x" },
        { name: "Dir/file", data: "y" },
      ]),
    ).rejects.toThrow(/冲突/);
  });
  it("rejects oversized and dishonest entry sizes", async () => {
    await expect(
      extract([{ name: "large.vrm", data: "x", size: 512 * 1024 ** 2 + 1 }]),
    ).rejects.toThrow(/过大/);
    await expect(
      extract([{ name: "bad.vrm", data: "longer than declared", size: 1 }]),
    ).rejects.toThrow();
  });
  it("cancels between entries before writing the next resource", async () => {
    const controller = new AbortController();
    await expect(
      extract(
        [
          { name: "a", data: "one" },
          { name: "b", data: "two" },
        ],
        controller.signal,
        () => controller.abort(),
      ),
    ).rejects.toThrow();
    expect(await readdir(join(directories.at(-1)!, "stage"))).toEqual(["a"]);
  });
  it("reads PNG dimensions before decoding and rejects unknown image data", () => {
    const png = Buffer.alloc(24);
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png);
    png.writeUInt32BE(100000, 16);
    png.writeUInt32BE(512, 20);
    expect(readImageHeader(png).width).toBe(100000);
    expect(() => readImageHeader(Buffer.from("not an image"))).toThrow();
  });
  it("accepts UTF-8 SRT with explicit intervals, gaps, multiline text and skipped cue numbers", () => {
    const source = "\uFEFF1\r\n00:00:00,100 --> 00:00:00,900\r\n第一行\r\n第二行\r\n\r\n3\r\n00:00:01,100 --> 00:00:02,500\r\n下一句\r\n";
    expect(validatePackageSrt(Buffer.from(source))).toBe(2.5);
    const unicode = `1\n00:00:00,000 --> 00:00:01,000\n${"🎵".repeat(1000)}`;
    expect(validatePackageSrt(Buffer.from(unicode))).toBe(1);
  });
  it("rejects malformed, overlapping, unbounded or ambiguous SRT cues", () => {
    const cue = "1\n00:00:00,100 --> 00:00:00,900\n测试";
    for (const source of [
      "", cue.replace("1\n", "2\n"), cue.replace("1\n", "2147483648\n"),
      cue.replace("00:00:00,900", "00:00:00,100"),
      cue.replace("00:00:00,900", "00:00:60,000"),
      cue.replace("00:00:00,900", "01:00:00,001"),
      cue.replace("00:00:00,100", "00:00:00.100"),
      cue.replace("测试", ""), cue.replace("测试", "测试\t文本"),
      cue.replace("测试", "\u0000"), cue.replace("测试", "字".repeat(1001)),
      `${cue}\n\n1\n00:00:01,000 --> 00:00:02,000\n重复编号`,
      `${cue}\n\n2\n00:00:00,800 --> 00:00:02,000\n重叠`,
    ]) expect(() => validatePackageSrt(Buffer.from(source))).toThrow(/字幕/);
    expect(() => validatePackageSrt(new Uint8Array([255]))).toThrow(/UTF-8/);
    expect(() => validatePackageSrt(Buffer.alloc(1024 ** 2 + 1))).toThrow(/1 MiB/);
    expect(() => validatePackageSrt(Buffer.from(Array.from({ length: 4097 }, () => cue).join("\n\n")))).toThrow(/4096/);
  });
});
