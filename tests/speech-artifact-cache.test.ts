import { afterEach, expect, it } from "vitest";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSpeechArtifactCache } from "../src/main/speech/speechArtifactCache";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "katarune-cache-test-")); roots.push(root);
  return { root, cache: createSpeechArtifactCache(root) };
}
const key = "a".repeat(64);
const artifact = { audio: new Uint8Array([1, 2, 3]), format: "wav", mediaType: "audio/wav" as const,
  segments: [{ text: "一二三", startSeconds: 0, endSeconds: 1 }] };
it("evicts the complete artifact as a unit", async () => {
  const { root } = await fixture();
  const cache = createSpeechArtifactCache(root, 1);
  await cache.put(key, artifact, new AbortController().signal);
  expect(await cache.get(key)).toBeNull();
  expect(await readdir(join(root, "timestamped-v1"))).toEqual([]);
});
it("publishes audio and alignment together and rejects corrupted audio", async () => {
  const { root, cache } = await fixture();
  await cache.put(key, artifact, new AbortController().signal);
  expect(await cache.get(key)).toEqual(artifact);
  const file = join(root, "timestamped-v1", `${key}.json`);
  const value = JSON.parse(await readFile(file, "utf8"));
  value.audio = "BAUG";
  await writeFile(file, JSON.stringify(value));
  expect(await cache.get(key)).toBeNull();
});
it("does not publish a cancelled replacement or leave a hittable partial artifact", async () => {
  const { root, cache } = await fixture();
  await cache.put(key, artifact, new AbortController().signal);
  const abort = new AbortController(); abort.abort();
  await expect(cache.put(key, { ...artifact, audio: new Uint8Array([4]) }, abort.signal)).rejects.toThrow();
  expect(await cache.get(key)).toEqual(artifact);
  expect(await readdir(join(root, "timestamped-v1"))).toEqual([`${key}.json`]);
});
