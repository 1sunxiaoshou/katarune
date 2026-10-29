import { LIVE_PREVIEW_MIME, type LivePreview } from "../../../shared/live";

// A media element can have only one MediaElementAudioSourceNode, including after
// effect cleanup/re-entry. Reuse its graph and one context per renderer; suspend
// that context when the preview closes rather than leaving an audio thread idle.
let audioContext: AudioContext | undefined;
const audioGraphs = new WeakMap<HTMLVideoElement, { context: AudioContext; source: MediaElementAudioSourceNode; gain: GainNode }>();
function audioGraph(video: HTMLVideoElement) {
  let graph = audioGraphs.get(video);
  if (!graph) {
    const context = audioContext ??= new AudioContext();
    const source = context.createMediaElementSource(video), gain = context.createGain();
    gain.gain.value = 0;
    graph = { context, source, gain }; audioGraphs.set(video, graph);
  }
  return graph;
}

function completed(target: EventTarget, event: string, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer); target.removeEventListener(event, done);
      target.removeEventListener("error", failed); signal.removeEventListener("abort", cancelled);
    };
    const done = () => { cleanup(); resolve(); };
    const failed = () => { cleanup(); reject(new Error("直播预览解码失败。")); };
    const cancelled = () => { cleanup(); reject(new DOMException("Preview closed", "AbortError")); };
    const timer = setTimeout(failed, 5000);
    target.addEventListener(event, done, { once: true });
    target.addEventListener("error", failed, { once: true });
    signal.addEventListener("abort", cancelled, { once: true });
    if (signal.aborted) cancelled();
  });
}

// SourceBuffer owns track timestamps and Chromium schedules audio/video together.
// IPC sends only one fragment until append/removal completes. Each fragment starts
// at an IDR, so a skipped fragment or hidden page can rejoin without a growing queue.
export class LivePreviewPlayer {
  private source: MediaSource | undefined;
  private buffer: SourceBuffer | undefined;
  private url: string | undefined;
  private lifetime = new AbortController();
  private sequence: number | undefined;
  private started = false;
  private playing: Promise<void> | undefined;
  private audio: ReturnType<typeof audioGraph> | undefined;
  private monitor = false;
  constructor(private readonly video: HTMLVideoElement, private readonly onError: (error: unknown) => void) {}

  setMonitor(enabled: boolean) {
    this.monitor = enabled;
    // The graph and the media clock keep running. Ramp the output gain to avoid
    // clicks without muting the media element or switching its audio sink.
    if (this.audio) {
      const now = this.audio.context.currentTime, gain = this.audio.gain.gain;
      gain.cancelScheduledValues(now); gain.setValueAtTime(gain.value, now);
      gain.linearRampToValueAtTime(enabled ? 1 : 0, now + .01);
    }
  }

  close() {
    this.lifetime.abort(); this.video.pause(); this.video.removeAttribute("src"); this.video.load();
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = undefined; this.buffer = undefined; this.source = undefined; this.sequence = undefined;
    this.started = false; this.playing = undefined;
    if (this.audio) {
      this.audio.source.disconnect(); this.audio.gain.disconnect();
      void this.audio.context.suspend().catch(() => {}); this.audio = undefined;
    }
  }

  async append(frame: LivePreview) {
    if (!this.buffer || this.sequence === undefined || frame.sequence !== this.sequence + 1) {
      this.close(); this.lifetime = new AbortController();
      const signal = this.lifetime.signal;
      this.audio = audioGraph(this.video);
      this.audio.gain.gain.cancelScheduledValues(0); this.audio.gain.gain.value = this.monitor ? 1 : 0;
      this.audio.source.connect(this.audio.gain); this.audio.gain.connect(this.audio.context.destination);
      void this.audio.context.resume().catch(error => { if (!signal.aborted) this.onError(error); });
      if (!MediaSource.isTypeSupported(LIVE_PREVIEW_MIME)) throw new Error("当前运行环境不支持直播音视频预览。");
      this.source = new MediaSource();
      const opened = completed(this.source, "sourceopen", this.lifetime.signal);
      this.url = URL.createObjectURL(this.source); this.video.src = this.url;
      await opened;
      this.buffer = this.source.addSourceBuffer(LIVE_PREVIEW_MIME);
      this.source.duration = Infinity;
      await this.appendBuffer(frame.initialization);
    }
    await this.appendBuffer(frame.fragment);
    this.sequence = frame.sequence;
    const ranges = this.video.buffered;
    if (!ranges.length) return;
    const start = ranges.start(ranges.length - 1), end = ranges.end(ranges.length - 1);
    // Two half-second segments provide headroom for audio-device scheduling.
    // ACK the first segment even while playback is waiting for the next one.
    if (!this.started && end - start < .75) return;
    // Bound latency after stalls, while normal playback stays on the audio clock.
    if (!this.started || this.video.currentTime < start || end - this.video.currentTime > 2) this.video.currentTime = Math.max(start, end - .75);
    this.started = true;
    this.source?.setLiveSeekableRange(start, end);
    this.resume();
    if (this.buffer && this.video.currentTime > 10 && ranges.start(0) < this.video.currentTime - 8) {
      const removed = completed(this.buffer, "updateend", this.lifetime.signal);
      this.buffer.remove(0, this.video.currentTime - 5); await removed;
    }
  }

  private resume() {
    if (!this.video.paused || this.playing) return;
    const signal = this.lifetime.signal;
    const playing = this.video.play(); this.playing = playing;
    // play() can wait for audio initialization or future media. Awaiting it here
    // would withhold the IPC ACK and prevent that future media from arriving.
    void playing.catch(error => {
      if (!signal.aborted && !(error instanceof DOMException && error.name === "AbortError")) this.onError(error);
    }).finally(() => { if (this.playing === playing) this.playing = undefined; });
  }

  private async appendBuffer(bytes: Uint8Array) {
    const buffer = this.buffer;
    if (!buffer) throw new DOMException("Preview closed", "AbortError");
    const updated = completed(buffer, "updateend", this.lifetime.signal);
    try { buffer.appendBuffer(new Uint8Array(bytes).buffer); }
    catch (error) { this.lifetime.abort(); await updated.catch(() => {}); throw error; }
    await updated;
  }
}
