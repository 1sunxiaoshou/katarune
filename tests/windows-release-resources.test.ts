import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "katarune-release-"));
  roots.push(root);
  for (const file of ["characters/default-package/portrait.png", "asr/sensevoice-int8/model.int8.onnx",
    "asr/sensevoice-int8/tokens.txt", "asr/sensevoice-int8/LICENSE", "asr/silero-vad/model.onnx",
    "asr/silero-vad/LICENSE", "asr-worker.cjs", "vad-segmenter.cjs", "avatar/KataruneAvatar.exe",
    "avatar/UnityPlayer.dll", "avatar/KataruneAvatar_Data/KataruneLocal/Models/default-avatar.vrm"]) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), "fixture");
  }
  mkdirSync(join(root, "avatar/MonoBleedingEdge"));
  const manifest = JSON.stringify({ model: "Models/default-avatar.vrm", portrait: "portrait.png", systemActions: {}, customActions: [] });
  writeFileSync(join(root, "characters/default-package/manifest.json"), manifest);
  writeFileSync(join(root, "avatar/KataruneAvatar_Data/KataruneLocal/manifest.json"), manifest);
  return root;
}
function verify(root: string) {
  return spawnSync(process.execPath, [resolve("scripts/verify-windows-resources.mjs"), root], { encoding: "utf8" });
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("Windows packaged resources", () => {
  it("accepts a complete bundle and rejects a missing VRM", () => {
    const root = fixture();
    expect(verify(root).status).toBe(0);
    rmSync(join(root, "avatar/KataruneAvatar_Data/KataruneLocal/Models/default-avatar.vrm"));
    expect(verify(root).stderr).toContain("default-avatar.vrm");
    expect(verify(root).status).not.toBe(0);
  });
  it("rejects missing Unity runtime dependencies", () => {
    const root = fixture();
    rmSync(join(root, "avatar/UnityPlayer.dll"));
    expect(verify(root).stderr).toContain("UnityPlayer.dll");
  });
  it("checks referenced actions and rejects empty ASR models", () => {
    const root = fixture();
    writeFileSync(join(root, "asr/silero-vad/model.onnx"), "");
    expect(verify(root).stderr).toContain("model.onnx");
    writeFileSync(join(root, "asr/silero-vad/model.onnx"), "fixture");
    writeFileSync(join(root, "characters/default-package/manifest.json"), JSON.stringify({
      model: "Models/default-avatar.vrm", portrait: "portrait.png",
      systemActions: { idle: { file: "Motions/idle.vrma" } }, customActions: [] }));
    expect(verify(root).stderr).toContain("idle.vrma");
  });
});
