import { readFile, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

async function requireFile(path) {
  const info = await stat(path).catch(() => null);
  if (!info?.isFile() || info.size === 0) throw new Error(`Required release file missing or empty: ${path}`);
}

function resourcePath(root, file) {
  const path = resolve(root, file);
  const remainder = relative(root, path);
  if (!remainder || remainder.startsWith("..") || isAbsolute(remainder)) throw new Error(`Invalid resource path: ${file}`);
  return path;
}

export async function verifyWindowsResources(root, packaged = false) {
  const resources = packaged ? root : join(root, "resources");
  const builtin = join(resources, "characters", "default-package");
  const avatar = join(resources, "avatar");
  const runtime = packaged ? join(avatar, "KataruneAvatar_Data", "KataruneLocal")
    : join(root, "unity", "KataruneAvatar", "Assets", "KataruneLocal");
  const manifest = JSON.parse(await readFile(join(builtin, "manifest.json"), "utf8"));
  for (const image of [manifest.portrait, manifest.thumbnail].filter(Boolean)) await requireFile(resourcePath(builtin, image));
  const actions = manifest.systemActions ?? {};
  const runtimeFiles = [manifest.model, actions.idle?.file,
    ...(actions.idle_variations ?? []).map(action => action.file),
    ...(manifest.customActions ?? []).map(action => action.file)].filter(Boolean);
  if (!manifest.model) throw new Error("Default character manifest must reference a VRM model.");
  for (const file of runtimeFiles) {
    const local = resourcePath(runtime, file);
    // AvatarBuilder also copies animations/assets supplied in the builtin package.
    const source = !packaged && (await stat(resourcePath(builtin, file)).catch(() => null))?.isFile()
      ? resourcePath(builtin, file) : local;
    await requireFile(source);
  }
  for (const file of ["asr/sensevoice-int8/model.int8.onnx", "asr/sensevoice-int8/tokens.txt",
    "asr/sensevoice-int8/LICENSE", "asr/silero-vad/model.onnx", "asr/silero-vad/LICENSE",
    "asr-worker.cjs", "vad-segmenter.cjs"]) await requireFile(join(resources, file));
  if (packaged) {
    for (const file of ["KataruneAvatar.exe", "UnityPlayer.dll"]) await requireFile(join(avatar, file));
    for (const directory of ["KataruneAvatar_Data", "MonoBleedingEdge"]) {
      if (!(await stat(join(avatar, directory)).catch(() => null))?.isDirectory()) {
        throw new Error(`Required Unity directory missing: ${directory}`);
      }
    }
    await requireFile(join(runtime, "manifest.json"));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const packaged = Boolean(process.argv[2]);
  await verifyWindowsResources(packaged ? resolve(process.argv[2]) : resolve(import.meta.dirname, ".."), packaged);
  console.log(`Windows ${packaged ? "packaged" : "source"} resources verified.`);
}
