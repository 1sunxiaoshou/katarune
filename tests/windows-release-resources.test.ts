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
    "avatar/UnityPlayer.dll", "avatar/KataruneAvatar_Data/KataruneLocal/avatar/model.vrm"]) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), "fixture");
  }
  mkdirSync(join(root, "avatar/MonoBleedingEdge"));
  const manifest = JSON.stringify({ formatVersion: 3, model: "avatar/model.vrm", portrait: "portrait.png", actions: [] });
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
    rmSync(join(root, "avatar/KataruneAvatar_Data/KataruneLocal/avatar/model.vrm"));
    expect(verify(root).stderr).toContain("model.vrm");
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
      formatVersion: 3, model: "avatar/model.vrm", portrait: "portrait.png",
      actions: [{ key: "idle", playback: { kind: "loop", motion: "Motions/idle.vrma" } }] }));
    expect(verify(root).stderr).toContain("idle.vrma");
  });
  it("requires the subtitles referenced by a packaged dance", () => {
    const root = fixture();
    const runtime = join(root, "avatar/KataruneAvatar_Data/KataruneLocal");
    mkdirSync(join(runtime, "Dances"));
    for (const file of ["dance.vrma", "music.wav", "lyrics.srt", "camera.glb"]) writeFileSync(join(runtime, "Dances", file), "fixture");
    writeFileSync(join(root, "characters/default-package/manifest.json"), JSON.stringify({
      formatVersion: 3, model: "avatar/model.vrm", portrait: "portrait.png",
      actions: [{ id: "dance", name: "舞蹈", playback: {
        kind: "performance", motion: "Dances/dance.vrma", audio: "Dances/music.wav", subtitles: "Dances/lyrics.srt", camera: { kind: "track", file: "Dances/camera.glb" } } }] }));
    expect(verify(root).status).toBe(0);
    rmSync(join(runtime, "Dances/lyrics.srt"));
    const result = verify(root);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("lyrics.srt");
    writeFileSync(join(runtime, "Dances/lyrics.srt"), "fixture");
    rmSync(join(runtime, "Dances/camera.glb"));
    expect(verify(root).stderr).toContain("camera.glb");
  });
});
