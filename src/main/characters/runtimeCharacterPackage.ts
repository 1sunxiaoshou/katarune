import type {
  ActionPlayback,
  CharacterPackage,
  RuntimeCharacterPackage,
} from "../../shared/characterPackages";

type PackageContents = Pick<CharacterPackage, "id" | "manifest" | "actions">;
type ResolvePath = (path: string) => string;

function resolvePlayback(playback: ActionPlayback, resolvePath: ResolvePath): ActionPlayback {
  const layer = playback.layer ?? "body";
  const common = {
    motion: resolvePath(playback.motion),
    layer,
    blending: playback.blending ?? (layer === "head" ? "additive" : "override"),
    blendSeconds: playback.blendSeconds ?? 0.2,
  } as const;

  if (playback.kind === "performance") {
    const camera = playback.camera;
    return {
      ...playback,
      ...common,
      layer: "body",
      blending: "override",
      ...(playback.audio ? { audio: resolvePath(playback.audio) } : {}),
      ...(playback.subtitles ? { subtitles: resolvePath(playback.subtitles) } : {}),
      ...(camera?.kind === "track" ? { camera: { ...camera, file: resolvePath(camera.file) } } : {}),
    };
  }

  const resolved = { ...playback, ...common };
  if (resolved.reference) resolved.reference = resolvePath(resolved.reference);
  if (resolved.kind === "loop") {
    if (resolved.enter) resolved.enter = resolvePath(resolved.enter);
    if (resolved.exit) resolved.exit = resolvePath(resolved.exit);
  }
  return resolved;
}

export function createRuntimeCharacterPackage(
  pack: PackageContents,
  resolvePath: ResolvePath,
  loadDefaults?: () => { pack: PackageContents; resolvePath: ResolvePath },
): RuntimeCharacterPackage {
  const { manifest } = pack;
  const actions = pack.actions.map(action => ({
    ...action,
    playback: resolvePlayback(action.playback, resolvePath),
  }));

  const actionId = (key: string) => {
    const action = actions.find(action => action.key === key);
    if (!action) throw new Error("角色包动作引用已损坏。");
    return action.id;
  };

  let variations = manifest.idle?.variations?.map(actionId);
  if (variations === undefined && loadDefaults) {
    const defaults = loadDefaults();
    variations = (defaults.pack.manifest.idle?.variations ?? []).map(defaultKey => {
      const action = defaults.pack.actions.find(action => action.key === defaultKey);
      if (!action) throw new Error("默认包待机引用已损坏。");
      if (!actions.some(existing => existing.id === action.id)) {
        let key = action.key;
        while (actions.some(existing => existing.key === key)) key = `fallback-${key}`;
        actions.push({ ...action, key, playback: resolvePlayback(action.playback, defaults.resolvePath) });
      }
      return action.id;
    });
  }

  const model = resolvePath(manifest.model);
  const base = manifest.idle?.base ? actionId(manifest.idle.base) : undefined;
  const bindings: RuntimeCharacterPackage["bindings"] = [];
  for (const [role, key] of Object.entries(manifest.bindings ?? {})) {
    if (key !== undefined) bindings.push({ role, actionId: actionId(key) });
  }
  return {
    formatVersion: 3,
    id: pack.id,
    version: manifest.version,
    model,
    actions,
    idle: {
      ...(base ? { base } : {}),
      variations: variations ?? [],
    },
    bindings,
  };
}
