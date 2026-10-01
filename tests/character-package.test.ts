import { mkdtemp, rm, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  extractPackage,
  parsePackageManifest,
  readImageHeader,
} from "../src/main/characters/packageArchive";
import { isPackagePath } from "../src/shared/characterPackages";
import { packageZip } from "./packageZip";

const manifest = {
  formatVersion: 1,
  name: "测试包",
  version: "1.0.0",
  portrait: "portrait.png",
  model: "avatar.vrm",
  systemActions: {},
  customActions: [],
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
  it("accepts an empty animation list and Unicode names", () => {
    expect(
      parsePackageManifest(JSON.stringify(manifest)).systemActions,
    ).toEqual({});
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
});
