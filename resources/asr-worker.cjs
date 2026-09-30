const { createRequire } = require('node:module');
const { join } = require('node:path');
const load = createRequire(join(process.argv[2], 'package.json'));
const { OfflineRecognizer, Vad } = load('sherpa-onnx-node');
const { VadSegmenter } = require('./vad-segmenter.cjs');
let recognizer;
let segmenter;
function loadAsr() {
  recognizer ??= new OfflineRecognizer({
    featConfig: { sampleRate: 16000, featureDim: 80 },
    modelConfig: {
      senseVoice: { model: join(process.argv[3], 'model.int8.onnx'), language: 'auto', useInverseTextNormalization: 1 },
      tokens: join(process.argv[3], 'tokens.txt'), numThreads: 2, provider: 'cpu', debug: 0,
    },
  });
}
function decode(samples) {
  const stream = recognizer.createStream();
  stream.acceptWaveform({ samples, sampleRate: 16000 });
  recognizer.decode(stream);
  return recognizer.getResult(stream).text.replace(/<\|[^|]*\|>/g, '').trim();
}
process.parentPort.on('message', ({ data }) => {
  let result;
  try {
    result = { status: 'success', text: '' };
    switch (data.operation) {
      case 'load': loadAsr(); break;
      case 'vad-load':
        segmenter ??= new VadSegmenter(new Vad({
          sileroVad: { model: join(process.argv[3], '../silero-vad/model.onnx'), threshold: 0.5,
            minSilenceDuration: 1.2, minSpeechDuration: 0.25, windowSize: 512, maxSpeechDuration: 30 },
          sampleRate: 16000, numThreads: 1, provider: 'cpu', debug: 0,
        }, 32));
        segmenter.reset(); break;
      case 'reset': segmenter?.reset(); break;
      case 'transcribe': result.text = decode(data.samples); break;
      case 'frame': {
        const segment = segmenter.accept(data.samples);
        result.speech = segment.speech;
        result.complete = !!segment.audio;
        if (segment.audio) {
          process.parentPort.postMessage({ id: data.id, progress: 'transcribing' });
          result.text = decode(segment.audio);
        }
        break;
      }
      default: throw new Error('Unknown operation');
    }
  } catch {
    result = { status: 'error', message: data.operation === 'load' || data.operation === 'vad-load'
      ? '离线语音模型无法加载，请检查 SenseVoice 与 Silero 语音资源。' : '离线语音识别失败，请重试。' };
  }
  process.parentPort.postMessage({ id: data.id, result });
});
