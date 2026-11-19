import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createRuntimeCharacterPackage } from "../src/main/characters/runtimeCharacterPackage.ts";

export async function loadDefaultRuntimePackage(root) {
  const [manifestJson, idsJson] = await Promise.all([
    readFile(join(root, "manifest.json"), "utf8"),
    readFile(join(root, "action-ids.json"), "utf8"),
  ]);
  const manifest = JSON.parse(manifestJson);
  const actionIds = JSON.parse(idsJson);
  const actions = manifest.actions.map(action => ({ ...action, id: actionIds[action.key] }));
  const runtime = createRuntimeCharacterPackage(
    { id: "builtin:default", manifest, actions },
    file => join(root, file),
  );
  return { runtime, actionIds };
}
