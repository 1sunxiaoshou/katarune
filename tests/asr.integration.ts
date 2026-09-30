import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { app, BrowserWindow, ipcMain } from 'electron';
import { AsrService } from '../src/main/speech/asrService';
import { ASR_CHANNELS, asrRequestIdSchema, asrRequestSchema } from '../src/shared/asr';

app.setPath('userData', resolve('.test-dist/asr/user-data'));
app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
app.commandLine.appendSwitch('use-fake-device-for-media-stream');
app.commandLine.appendSwitch('use-file-for-fake-audio-capture', resolve('.test-dist/asr/zh.wav'));
const resources = process.env.KATARUNE_ASR_PACKAGED_ROOT ?? resolve('resources');
const application = process.env.KATARUNE_ASR_PACKAGED_ROOT ? resolve(resources, 'app.asar') : process.cwd();
const service = new AsrService(application, resources);
let window: BrowserWindow | undefined;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

void app.whenReady().then(async () => {
  try {
    ipcMain.handle(ASR_CHANNELS.prepare, (event, value) => service.prepare(event.sender.id, asrRequestIdSchema.parse(value).requestId));
    ipcMain.handle(ASR_CHANNELS.transcribe, (event, value) => {
      const request = asrRequestSchema.parse(value);
      return service.transcribe(event.sender.id, request.requestId, request.samples);
    });
    window = new BrowserWindow({ show: false, webPreferences: { preload: resolve(application, 'out/preload/index.cjs'), contextIsolation: true, sandbox: true, backgroundThrottling: false } });
    await window.loadFile(resolve('.test-dist/asr/capture.html'));
    const id = crypto.randomUUID();
    const started = performance.now();
    assert.equal((await service.prepare(123, id)).status, 'success');
    console.log(`ASR cold load: ${Math.round(performance.now() - started)} ms`);
    const bytes = await readFile('.test-dist/asr/zh.wav');
    const samples = new Float32Array((bytes.length - 44) / 2);
    for (let i = 0; i < samples.length; i++) samples[i] = bytes.readInt16LE(44 + i * 2) / 32768;
    const decodeStart = performance.now();
    const result = await service.transcribe(123, id, samples);
    assert.equal(result.status, 'success');
    if (result.status === 'success') {
      assert.match(result.text, /早上9点至下午5点。/);
      console.log(`ASR ${samples.length / 16000}s audio: ${Math.round(performance.now() - decodeStart)} ms; ${result.text}`);
    }
    const capture = await window.webContents.executeJavaScript(`(async () => {
      const requestId = crypto.randomUUID();
      const prepared = await window.katarune.prepareAsr({ requestId });
      if (prepared.status !== 'success') throw new Error(JSON.stringify(prepared));
      const stream = await navigator.mediaDevices.getUserMedia({audio:true});
      const recorder = new MediaRecorder(stream, {mimeType:'audio/webm;codecs=opus'});
      const chunks = [];
      recorder.ondataavailable = e => chunks.push(e.data);
      recorder.start(250);
      await new Promise(r => setTimeout(r, 6500));
      await new Promise(r => {recorder.onstop=r;recorder.stop();});
      stream.getTracks().forEach(t=>t.stop());
      const context = new AudioContext({sampleRate:16000});
      const audio = await context.decodeAudioData(await new Blob(chunks).arrayBuffer());
      const samples = audio.getChannelData(0).map(v => Math.max(-1, Math.min(1, v)));
      const result = await window.katarune.transcribeAsr({requestId,samples});
      await context.close();
      return result;
    })()`);
    assert.equal(capture.status, 'success');
    assert.match(capture.text, /时间/);
    assert.match(capture.text, /[。！？]/);
    console.log(`Electron fake microphone → MediaRecorder → PCM → preload → utilityProcess: ${capture.text}`);
    const realtimeId = crypto.randomUUID();
    const warmStart = performance.now();
    assert.equal((await service.prepare(123, realtimeId, true)).status, 'success');
    console.log(`Warm ASR + first Silero load: ${Math.round(performance.now() - warmStart)} ms`);
    const voiceAndSilence = new Float32Array(samples.length + 32000);
    voiceAndSilence.set(samples);
    for (let turn = 0; turn < 10; turn++) {
      const started = performance.now();
      await service.reset(123, realtimeId);
      let completed = 0;
      for (let offset = 0; offset < voiceAndSilence.length; offset += 1600) {
        const result = await service.frame(123, realtimeId, voiceAndSilence.slice(offset, offset + 1600));
        assert.equal(result.status, 'success');
        if (result.status === 'success' && result.complete) {
          completed++;
          assert.match(result.text, /早上9点至下午5点。/);
          console.log(`VAD + ASR fixture turn ${turn + 1}: ${Math.round(performance.now() - started)} ms; ${result.text}`);
          break;
        }
      }
      assert.equal(completed, 1);
    }
    service.cancel(123, realtimeId);
    const cancelledId = crypto.randomUUID();
    await service.prepare(123, cancelledId);
    const pending = service.transcribe(123, cancelledId, new Float32Array(16_000 * 30));
    service.cancel(999, cancelledId); // Another sender cannot cancel this session.
    assert.equal((await service.prepare(999, crypto.randomUUID())).status, 'error');
    service.cancel(123, cancelledId);
    assert.equal((await pending).status, 'cancelled');
    const nextId = crypto.randomUUID();
    assert.equal((await service.prepare(456, nextId)).status, 'success');
    service.cancel(456, nextId);
    await sleep(50);
    console.log('ASR integration passed (real model, native child, microphone capture, cancellation, restart)');
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally { service.dispose(); window?.destroy(); app.exit(process.exitCode === 1 ? 1 : 0); }
});
