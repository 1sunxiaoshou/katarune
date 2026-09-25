class SpeechCapture extends AudioWorkletProcessor {
  constructor() {
    super(); this.enabled = false; this.buffer = new Float32Array(1600); this.offset = 0;
    this.port.onmessage = ({ data }) => { this.enabled = data === true; this.offset = 0; };
  }
  process(inputs) {
    const channels = inputs[0];
    if (!this.enabled || !channels?.length) return true;
    for (let i = 0; i < channels[0].length; i++) {
      let value = 0;
      for (const channel of channels) value += channel[i] || 0;
      this.buffer[this.offset++] = Math.max(-1, Math.min(1, value / channels.length));
      if (this.offset === this.buffer.length) {
        this.port.postMessage(this.buffer, [this.buffer.buffer]);
        this.buffer = new Float32Array(1600); this.offset = 0;
      }
    }
    return true;
  }
}
registerProcessor('speech-capture', SpeechCapture);
