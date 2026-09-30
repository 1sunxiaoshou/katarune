import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { resolve } from 'node:path';

const directory = resolve('resources/asr/sensevoice-int8');
const revision = '2365baeacb507f821a0c8120fcee3d484dba7a07';
const base = `https://huggingface.co/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/${revision}`;
const files = ['model.int8.onnx', 'tokens.txt', 'LICENSE'];
const modelHash = 'c71f0ce00bec95b07744e116345e33d8cbbe08cef896382cf907bf4b51a2cd51';
const tokenHash = 'f449eb28dc567533d7fa59be34e2abca8784f771850c78a47fb731a31429a1dc';
await mkdir(directory, { recursive: true });
for (const name of files) {
  const path = resolve(directory, name);
  const existing = await readFile(path).catch(() => null);
  const expected = name === 'model.int8.onnx' ? modelHash : name === 'tokens.txt' ? tokenHash : undefined;
  if (existing && (!expected || createHash('sha256').update(existing).digest('hex') === expected)) continue;
  console.log(`Downloading ${name}`);
  const response = await fetch(`${base}/${name}`, { signal: AbortSignal.timeout(600_000) });
  if (!response.ok) throw new Error(`Download failed: ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (expected && createHash('sha256').update(bytes).digest('hex') !== expected) throw new Error(`${name} SHA-256 mismatch`);
  await writeFile(`${path}.tmp`, bytes);
  await rename(`${path}.tmp`, path);
}
console.log(`SenseVoice INT8 ready: ${directory}`);

const vadDirectory = resolve('resources/asr/silero-vad');
const vadRevision = '5cd2ba54db059f961e7545d4f211b44f005a6dfb'; // Silero v5.0
await mkdir(vadDirectory, { recursive: true });
for (const [source, name, hash] of [
  ['files/silero_vad.onnx', 'model.onnx', '6b99cbfd39246b6706f98ec13c7c50c6b299181f2474fa05cbc8046acc274396'],
  ['LICENSE', 'LICENSE', '2e63e9a38b6e8fc0c7bc37ce174caca1862870856c6daf5697cfb785e925520b'],
]) {
  const path = resolve(vadDirectory, name);
  const existing = await readFile(path).catch(() => null);
  if (existing && createHash('sha256').update(existing).digest('hex') === hash) continue;
  const response = await fetch(`https://raw.githubusercontent.com/snakers4/silero-vad/${vadRevision}/${source}`, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`Silero download failed: ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (createHash('sha256').update(bytes).digest('hex') !== hash) throw new Error(`Silero ${name} SHA-256 mismatch`);
  await writeFile(`${path}.tmp`, bytes);
  await rename(`${path}.tmp`, path);
}
console.log(`Silero VAD ready: ${vadDirectory}`);
