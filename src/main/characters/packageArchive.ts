import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import * as yauzl from "yauzl";
import {
  isPackagePath,
  characterPackageManifestSchema,
} from "../../shared/characterPackages";

export async function hashFile(
  path: string,
  signal: AbortSignal,
): Promise<string> {
  const hash = createHash("sha256");
  await pipeline(createReadStream(path), hash, { signal });
  return hash.digest("hex");
}
export function parsePackageManifest(source: string) {
  const value: unknown = JSON.parse(source);
  // JSON.parse accepts duplicate keys; authors must not depend on last-key-wins.
  const stack: (Set<string> | null)[] = [];
  for (const match of source.matchAll(/"(?:\\.|[^"\\])*"|[{}\[\]]/g)) {
    const token = match[0];
    if (token === "{") stack.push(new Set());
    else if (token === "[") stack.push(null);
    else if (token === "}" || token === "]") stack.pop();
    else if (
      source
        .slice(match.index + token.length)
        .trimStart()
        .startsWith(":")
    ) {
      const keys = stack.at(-1);
      const key = JSON.parse(token) as string;
      if (keys?.has(key)) throw new Error(`清单重复字段：${key}`);
      keys?.add(key);
    }
  }
  return characterPackageManifestSchema.parse(value);
}
export async function extractPackage(
  path: string,
  destination: string,
  signal: AbortSignal,
  progress: (files: number) => void,
): Promise<string[]> {
  if ((await stat(path)).size > 1024 ** 3)
    throw new Error("角色包超过 1 GiB。");
  const zip = await new Promise<yauzl.ZipFile>((resolve, reject) =>
    yauzl.open(
      path,
      { lazyEntries: true, strictFileNames: true, validateEntrySizes: true },
      (error, archive) =>
        error || !archive
          ? reject(error ?? new Error("无效 ZIP"))
          : resolve(archive),
    ),
  );
  const names = new Set<string>();
  const directories = new Set<string>();
  const regularFiles = new Set<string>();
  const files: string[] = [];
  let total = 0;
  let entries = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const entry = await new Promise<yauzl.Entry | null>((resolve, reject) => {
        const cleanup = () => {
          zip.off("entry", onEntry);
          zip.off("end", onEnd);
          zip.off("error", onError);
          signal.removeEventListener("abort", onAbort);
        };
        const onEntry = (value: yauzl.Entry) => {
          cleanup();
          resolve(value);
        };
        const onEnd = () => {
          cleanup();
          resolve(null);
        };
        const onError = (error: Error) => {
          cleanup();
          reject(error);
        };
        const onAbort = () => {
          cleanup();
          reject(signal.reason);
        };
        zip.once("entry", onEntry);
        zip.once("end", onEnd);
        zip.once("error", onError);
        signal.addEventListener("abort", onAbort, { once: true });
        zip.readEntry();
      });
      if (!entry) break;
      if (++entries > 2048) throw new Error("ZIP 条目过多。");
      const directory = entry.fileName.endsWith("/");
      const name = directory ? entry.fileName.slice(0, -1) : entry.fileName;
      if (!isPackagePath(name)) throw new Error("角色包包含非法路径。");
      const key = name.toLowerCase();
      if (names.has(key)) throw new Error("角色包包含重复路径。");
      names.add(key);
      if (!directory && directories.has(key))
        throw new Error("角色包包含文件与目录冲突。");
      const components = key.split("/");
      for (let depth = 1; depth < components.length; depth++) {
        const parent = components.slice(0, depth).join("/");
        if (regularFiles.has(parent))
          throw new Error("角色包包含文件与目录冲突。");
        directories.add(parent);
      }
      if (directory) directories.add(key);
      else regularFiles.add(key);
      const mode = (entry.externalFileAttributes >>> 16) & 0xf000;
      if (
        (mode && mode !== (directory ? 0x4000 : 0x8000)) ||
        entry.isEncrypted()
      )
        throw new Error("不支持链接、特殊文件或加密 ZIP。");
      if (directory) {
        await mkdir(join(destination, name), { recursive: true });
        continue;
      }
      if (files.length >= 1024 || entry.uncompressedSize > 512 * 1024 ** 2)
        throw new Error("资源数量或单个文件过大。");
      const target = join(destination, name);
      await mkdir(dirname(target), { recursive: true });
      const stream = await new Promise<import("node:stream").Readable>(
        (resolve, reject) =>
          zip.openReadStream(entry, (error, stream) =>
            error || !stream ? reject(error) : resolve(stream),
          ),
      );
      await pipeline(
        stream,
        new Transform({
          transform(chunk: Buffer, _encoding, callback) {
            total += chunk.length;
            callback(
              total > 2 * 1024 ** 3 ? new Error("解压总量超过 2 GiB。") : null,
              chunk,
            );
          },
        }),
        createWriteStream(target, { flags: "wx" }),
        { signal },
      );
      files.push(name);
      progress(files.length);
    }
    return files;
  } finally {
    zip.close();
  }
}

export function readImageHeader(bytes: Buffer): {
  width: number;
  height: number;
  mime: string;
} {
  if (
    bytes.length >= 24 &&
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return {
      width: bytes.readUInt32BE(16),
      height: bytes.readUInt32BE(20),
      mime: "image/png",
    };
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString() === "RIFF" &&
    bytes.subarray(8, 12).toString() === "WEBP"
  ) {
    const kind = bytes.subarray(12, 16).toString();
    if (kind === "VP8X" && bytes.length >= 30)
      return {
        width: 1 + bytes.readUIntLE(24, 3),
        height: 1 + bytes.readUIntLE(27, 3),
        mime: "image/webp",
      };
    if (
      kind === "VP8 " &&
      bytes.length >= 30 &&
      bytes.subarray(23, 26).equals(Buffer.from([157, 1, 42]))
    )
      return {
        width: bytes.readUInt16LE(26) & 0x3fff,
        height: bytes.readUInt16LE(28) & 0x3fff,
        mime: "image/webp",
      };
    if (kind === "VP8L" && bytes.length >= 25 && bytes[20] === 0x2f) {
      const n = bytes.readUInt32LE(21);
      return {
        width: (n & 0x3fff) + 1,
        height: ((n >>> 14) & 0x3fff) + 1,
        mime: "image/webp",
      };
    }
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset++] !== 0xff) break;
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === 0xd9 || marker === 0xda || marker === undefined) break;
      const size = bytes.readUInt16BE(offset);
      if (size < 2 || offset + size > bytes.length) break;
      if (
        [
          0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd,
          0xce, 0xcf,
        ].includes(marker) &&
        size >= 8
      )
        return {
          width: bytes.readUInt16BE(offset + 5),
          height: bytes.readUInt16BE(offset + 3),
          mime: "image/jpeg",
        };
      offset += size;
    }
  }
  throw new Error("无法读取图片尺寸或图片格式不支持。");
}
