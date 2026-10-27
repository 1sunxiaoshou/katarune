import { join } from "node:path";

// File-backed integration fixture: use the delivered catalog and identity map.
export function runtimePackage(manifest, ids, root) {
  const resolve = file => join(root, file);
  const playback = p => ({
    ...p, motion: resolve(p.motion), layer: p.layer ?? "body",
    blending: p.blending ?? (p.layer === "head" ? "additive" : "override"),
    blendSeconds: p.blendSeconds ?? .2,
    ...Object.fromEntries(["enter", "exit", "reference", "audio", "subtitles"].filter(key => p[key]).map(key => [key, resolve(p[key])])),
    ...(p.camera?.kind === "track" ? { camera: { ...p.camera, file: resolve(p.camera.file) } } : {}),
  });
  return {
    formatVersion: 3, id: "builtin:default", version: manifest.version, model: resolve(manifest.model),
    actions: manifest.actions.map(a => ({ ...a, id: ids[a.key], playback: playback(a.playback) })),
    idle: { ...(manifest.idle?.base ? { base: ids[manifest.idle.base] } : {}), variations: (manifest.idle?.variations ?? []).map(key => ids[key]) },
    bindings: Object.entries(manifest.bindings ?? {}).map(([role, key]) => ({ role, actionId: ids[key] })),
  };
}
