import { spawn } from 'node:child_process';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import electron from 'electron';

await mkdir('.test-dist/asr', { recursive: true });
await writeFile('.test-dist/asr/capture.html', '<!doctype html><html><body>Offline ASR capture integration</body></html>');
// Public upstream fixture; no user recordings are uploaded or retained.
const fixtureHash = 'b77f1794fe374a0ba1ee1dc458bfaf9349496cbbfc32780c50ba3c5a7ad8e373';
const valid = bytes => bytes && createHash('sha256').update(bytes).digest('hex') === fixtureHash;
if (!valid(await readFile('.test-dist/asr/zh.wav').catch(() => null))) {
  const response = await fetch('https://huggingface.co/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/2365baeacb507f821a0c8120fcee3d484dba7a07/test_wavs/zh.wav', { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`ASR fixture download failed: ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!valid(bytes)) throw new Error('ASR fixture hash mismatch');
  await writeFile('.test-dist/asr/zh.wav', bytes);
}
await build({ entryPoints: ['tests/asr.integration.ts'], bundle: true, platform: 'node', format: 'cjs', packages: 'external', outfile: '.test-dist/asr/integration.cjs' });
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, [resolve('.test-dist/asr/integration.cjs')], { env, stdio: 'inherit', windowsHide: true });
const timeout = setTimeout(() => { child.kill(); process.exitCode = 1; }, 120_000);
child.on('exit', (code) => { clearTimeout(timeout); process.exitCode = code ?? 1; });
