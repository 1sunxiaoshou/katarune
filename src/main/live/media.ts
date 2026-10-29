import { spawn, execFile, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createServer } from "node:net";
import { mkdir, writeFile, access } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { LiveSettings, LivePreview } from "../../shared/live";
import { LiveOperationError } from "./errors";
import { liveOutputProfile } from "./outputProfile";
import { Mp4Preview } from "./mp4Preview";

export class LiveMedia {
  private process: ChildProcessWithoutNullStreams | undefined;
  private sequence = 0;
  private encoder: "h264_nvenc" | "h264_mf" | undefined;
  onFailure: (error: Error) => void = () => {};
  onPreview: (frame: LivePreview) => void = () => {};
  constructor(private readonly resources: string, private readonly work: string, private readonly acceptanceOutput?: (value: string) => void) {}
  async preflight(settings: LiveSettings, signal: AbortSignal) {
    const { fps } = liveOutputProfile(settings);
    if (process.platform !== "win32") throw new Error("直播输出目前仅支持 Windows。");
    try { for (const name of ["ffmpeg.exe", "mediamtx.exe", "media-supervisor.exe", "manifest.json"]) await access(join(this.resources, name)); }
    catch (cause) { throw new LiveOperationError("直播媒体资源不完整，请准备媒体资源或重新安装应用。", { cause }); }
    await new Promise<void>((resolve, reject) => {
      const server = createServer();
      server.once("error", () => reject(new LiveOperationError("直播本地端口已被占用，请在输出设置中修改。")));
      server.listen(settings.port, "127.0.0.1", () => server.close(error => error ? reject(error) : resolve()));
    });
    this.encoder = undefined;
    let failure: unknown;
    for (const encoder of ["h264_nvenc", "h264_mf"] as const) {
      signal.throwIfAborted();
      try {
        await promisify(execFile)(join(this.resources, "ffmpeg.exe"), ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", `color=size=${settings.width}x${settings.width * 9 / 16}:rate=${fps}`, "-frames:v", "12", "-an", ...this.encoding(settings, encoder), "-f", "null", "-"], { windowsHide: true, signal, timeout: 10_000, maxBuffer: 64 * 1024 });
        this.encoder = encoder; return;
      } catch (cause) { failure = cause; }
    }
    signal.throwIfAborted();
    throw new LiveOperationError("当前系统无法启动 H.264 硬件编码器，请检查显卡驱动。", { cause: failure });
  }
  private encoding(settings: LiveSettings, encoder: "h264_nvenc" | "h264_mf") {
    const { fps, videoBitrateKbps } = liveOutputProfile(settings);
    return ["-c:v", encoder, ...(encoder === "h264_nvenc"
      ? ["-preset", "p4", "-tune", "ll", "-rc", "cbr", "-rc-lookahead", "0", "-zerolatency", "1"]
      : ["-hw_encoding", "1", "-rate_control", "cbr", "-scenario", "live_streaming"]),
      "-pix_fmt", "nv12", "-profile:v", encoder === "h264_nvenc" ? "high" : "100", "-level:v", encoder === "h264_nvenc" ? "5.1" : "51",
      "-b:v", `${videoBitrateKbps}k`, "-maxrate", `${videoBitrateKbps}k`, "-bufsize", `${Math.round(videoBitrateKbps / 6)}k`,
      "-g", String(fps / 2), "-bf", "0"];
  }
  async start(settings: LiveSettings, pipe: string, signal: AbortSignal) {
    const { fps } = liveOutputProfile(settings);
    if (!this.encoder) throw new Error("直播硬件编码器尚未预检。");
    signal.throwIfAborted(); await mkdir(this.work, { recursive: true });
    const config = join(this.work, "mediamtx.yml");
    await writeFile(config, `logLevel: ${this.acceptanceOutput ? "info" : "error"}\nlogDestinations: [stdout]\napi: false\nmetrics: false\npprof: false\nplayback: false\nrtsp: false\nhls: false\nwebrtc: false\nsrt: false\nmoq: false\nrtmp: true\nrtmpAddress: 127.0.0.1:${settings.port}\npaths:\n  katarune/live:\n    source: publisher\n    overridePublisher: false\n`);
    signal.throwIfAborted();
    const args = [join(this.resources, "mediamtx.exe"), config, join(this.resources, "ffmpeg.exe"),
      "-hide_banner", "-nostdin", "-loglevel", this.acceptanceOutput ? "info" : "error", "-nostats", "-stats_period", "0.25", "-progress", "pipe:2",
      "-thread_queue_size", "4", "-probesize", "32", "-analyzeduration", "0", "-fpsprobesize", "0", "-f", "rawvideo", "-pixel_format", "rgba", "-video_size", `${settings.width}x${settings.width * 9 / 16}`, "-framerate", String(fps), "-i", `\\\\.\\pipe\\${pipe}-video`,
      "-thread_queue_size", "64", "-probesize", "32", "-analyzeduration", "0", "-f", "wav", "-ignore_length", "1", "-i", `\\\\.\\pipe\\${pipe}-audio`,
      "-map", "0:v:0", "-map", "1:a:0", ...this.encoding(settings, this.encoder),
      "-vf", "vflip,scale=in_range=full:out_range=limited:out_color_matrix=bt709,setparams=range=limited:color_primaries=bt709:color_trc=bt709:colorspace=bt709", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv",
      "-c:a", "aac", "-ar", "48000", "-ac", "2", "-b:a", "192k", "-flags", "+global_header", "-f", "tee",
      `[f=flv:flvflags=no_duration_filesize]rtmp://127.0.0.1:${settings.port}/katarune/live|[f=mp4:movflags=frag_keyframe+empty_moov+default_base_moof]pipe:1`];
    const child = spawn(join(this.resources, "media-supervisor.exe"), args, { windowsHide: true, stdio: "pipe" });
    this.process = child;
    const preview = new Mp4Preview((initialization, fragment) => this.onPreview({ initialization, fragment, sequence: this.sequence++ }));
    child.stdout.on("data", (bytes: Buffer) => {
      if (this.process !== child) return;
      try { preview.write(bytes); }
      catch { this.onFailure(new Error("直播预览媒体格式无效。")); void this.stop(); }
    });
    // stderr can contain local paths. Drain without forwarding raw media logs.
    await new Promise<void>((resolve, reject) => {
      let buffer = "", frame = false, settled = false;
      const cleanup = () => { clearTimeout(timer); signal.removeEventListener("abort", abort); };
      const finish = (error?: Error) => { if (settled) return; settled = true; cleanup(); error ? reject(error) : resolve(); };
      const abort = () => { void this.stop(); finish(new Error("直播启动已取消。")); };
      const timer = setTimeout(() => { void this.stop(); finish(new Error("直播编码器未能产生音视频，请检查输出设置。")); }, 30_000);
      signal.addEventListener("abort", abort, { once: true });
      const progress = (data: Buffer) => {
        this.acceptanceOutput?.(data.toString("utf8"));
        buffer += data.toString("utf8");
        if (buffer.length > 8192) buffer = buffer.slice(-8192);
        const lines = buffer.split(/\r?\n/); buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (line.startsWith("frame=") && Number(line.slice(6)) >= fps * 3) frame = true;
          if (frame && line.startsWith("out_time_us=") && Number(line.slice(12)) >= 3_000_000) finish();
        }
      };
      child.stderr.on("data", progress);
      child.once("error", () => finish(new Error("无法启动直播媒体进程。")));
      child.once("exit", code => {
        if (!settled) finish(new Error(`直播媒体进程提前退出（${code ?? -1}）。`));
        else if (this.process === child && !signal.aborted) this.onFailure(new Error("直播媒体进程已退出。"));
      });
    });
  }
  async stop() {
    const child = this.process; this.process = undefined;
    if (!child) return;
    child.stdin.end();
    await new Promise<void>(resolve => {
      if (child.exitCode !== null) { resolve(); return; }
      const timer = setTimeout(() => { child.kill(); resolve(); }, 2000);
      child.once("exit", () => { clearTimeout(timer); resolve(); });
    });
  }
}
