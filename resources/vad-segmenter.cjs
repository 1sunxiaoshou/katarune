/** Bounded PCM history adds pre-roll without retaining silence indefinitely. */
class VadSegmenter {
  constructor(vad) { this.vad = vad; this.history = new Float32Array(16000 * 32); this.reset(); }
  reset() {
    this.vad.reset(); this.vad.clear(); this.total = 0; this.start = undefined;
    this.remainder = new Float32Array(0); this.history.fill(0);
  }
  slice(start, end) {
    start = Math.max(0, start, this.total - this.history.length);
    const output = new Float32Array(Math.max(0, Math.min(end - start, 480000)));
    for (let i = 0; i < output.length; i++) output[i] = this.history[(start + i) % this.history.length];
    return output;
  }
  accept(samples) {
    const input = new Float32Array(this.remainder.length + samples.length);
    input.set(this.remainder); input.set(samples, this.remainder.length);
    let offset = 0;
    for (; offset + 512 <= input.length; offset += 512) {
      const window = input.subarray(offset, offset + 512);
      for (const value of window) this.history[this.total++ % this.history.length] = value;
      this.vad.acceptWaveform(window);
      if (this.vad.isDetected() && this.start === undefined) this.start = Math.max(0, this.total - 4096 - 4800);
      if (!this.vad.isEmpty()) {
        const segment = this.vad.front(false);
        const audio = this.slice(segment.start - 4800, segment.start + segment.samples.length);
        this.reset(); return { audio, speech: false };
      }
      if (this.start !== undefined && this.total - this.start >= 480000) {
        const audio = this.slice(this.start, this.start + 480000);
        this.reset(); return { audio, speech: false };
      }
    }
    this.remainder = input.slice(offset);
    return { speech: this.start !== undefined };
  }
}
module.exports = { VadSegmenter };
