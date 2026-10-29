import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";

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
  mkdirSync(join(root, "live-media"));
  const mediaFiles = ["ffmpeg.exe", "ffprobe.exe", "mediamtx.exe", "media-supervisor.exe", "avcodec-62.dll", "avdevice-62.dll", "avfilter-11.dll", "avformat-62.dll", "avutil-60.dll", "swresample-6.dll", "swscale-9.dll"];
  for (const file of [...mediaFiles, "ffmpeg-LICENSE.txt", "mediamtx-LICENSE", "SOURCES.md", "media-supervisor.cs"]) writeFileSync(join(root, "live-media", file), "fixture");
  writeFileSync(join(root, "live-media/checksums.json"), JSON.stringify(Object.fromEntries(mediaFiles.map(file => [file, createHash("sha256").update("fixture").digest("hex")]))));
  writeFileSync(join(root, "live-media/manifest.json"), JSON.stringify({ ffmpeg: { sha256: "fixture" }, mediamtx: { sha256: "fixture" } }));
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
  it("requires the bundled live encoder and process supervisor", () => {
    const root = fixture(); rmSync(join(root, "live-media/media-supervisor.exe"));
    expect(verify(root).status).not.toBe(0); expect(verify(root).stderr).toContain("media-supervisor.exe");
  });
  it("rejects a corrupted bundled media DLL", () => {
    const root = fixture(); writeFileSync(join(root, "live-media/avcodec-62.dll"), "corrupt");
    expect(verify(root).status).not.toBe(0); expect(verify(root).stderr).toContain("checksum mismatch: avcodec-62.dll");
  });
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
