import { spawn, execFile, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createServer } from "node:net";
import { mkdir, writeFile, access } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { liveOutputDimensions, type LiveSettings, type LivePreview } from "../../shared/live";
import { LiveMediaError, LiveOperationError, LivePortInUseError } from "./errors";
import { mediaProcessSchema } from "../../shared/diagnostics";
import { diagnostic, type DiagnosticContext } from "../diagnostics/logger";
import { liveOutputProfile } from "./outputProfile";
import { Mp4Preview } from "./mp4Preview";

const supervisorRecordSchema = z.discriminatedUnion("event", [
  z.strictObject({ event: z.literal("ready"), process: z.literal("server") }),
  z.strictObject({ event: z.literal("started"), process: z.literal("encoder") }),
  z.strictObject({ event: z.literal("timeout"), process: z.literal("server") }),
  z.strictObject({ event: z.literal("exited"), process: z.enum(["server", "encoder"]), code: z.int().min(0).max(0xffffffff) }),
  z.strictObject({ event: z.literal("launch-failed"), process: mediaProcessSchema, code: z.int().min(0).max(0xffffffff).optional() }),
]);

export class LiveMedia {
  private process: ChildProcessWithoutNullStreams | undefined;
  private closed: Promise<void> | undefined;
  private stopping: Promise<void> | undefined;
  private sequence = 0;
  private encoder: "h264_nvenc" | "h264_mf" | undefined;
  onFailure: (error: Error) => void = () => {};
  onPreview: (frame: LivePreview) => void = () => {};
  constructor(private readonly resources: string, private readonly work: string, private readonly acceptanceOutput?: (value: string) => void) {}
  async preflight(settings: LiveSettings, signal: AbortSignal) {
    const { fps } = liveOutputProfile(settings);
    const { width, height } = liveOutputDimensions(settings);
    if (process.platform !== "win32") throw new Error("直播输出目前仅支持 Windows。");
    try { for (const name of ["ffmpeg.exe", "mediamtx.exe", "media-supervisor.exe", "manifest.json"]) await access(join(this.resources, name)); }
    catch (cause) { throw new LiveOperationError("直播媒体资源不完整，请准备媒体资源或重新安装应用。", { cause }); }
    await new Promise<void>((resolve, reject) => {
      const server = createServer();
      server.once("error", error => reject("code" in error && error.code === "EADDRINUSE" ? new LivePortInUseError({ cause: error }) : error));
      server.listen(settings.port, "127.0.0.1", () => server.close(error => error ? reject(error) : resolve()));
    });
    this.encoder = undefined;
    let failure: unknown;
    for (const encoder of ["h264_nvenc", "h264_mf"] as const) {
      signal.throwIfAborted();
      try {
        await promisify(execFile)(join(this.resources, "ffmpeg.exe"), ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", `color=size=${width}x${height}:rate=${fps}`, "-frames:v", "12", "-an", ...this.encoding(settings, encoder), "-f", "null", "-"], { windowsHide: true, signal, timeout: 10_000, maxBuffer: 64 * 1024 });
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
    await this.stop();
    const { fps } = liveOutputProfile(settings);
    const { width, height } = liveOutputDimensions(settings);
    if (!this.encoder) throw new Error("直播硬件编码器尚未预检。");
    signal.throwIfAborted(); await mkdir(this.work, { recursive: true });
    const config = join(this.work, "mediamtx.yml");
    await writeFile(config, `logLevel: info\nlogDestinations: [stdout]\napi: false\nmetrics: false\npprof: false\nplayback: false\nrtsp: false\nhls: false\nwebrtc: false\nsrt: false\nmoq: false\nrtmp: true\nrtmpAddress: 127.0.0.1:${settings.port}\npaths:\n  katarune/live:\n    source: publisher\n    overridePublisher: false\n`);
    signal.throwIfAborted();
    const args = [join(this.resources, "mediamtx.exe"), config, join(this.resources, "ffmpeg.exe"),
      "-hide_banner", "-nostdin", "-loglevel", this.acceptanceOutput ? "info" : "error", "-nostats", "-stats_period", "0.25", "-progress", "pipe:2",
      "-thread_queue_size", "4", "-probesize", "32", "-analyzeduration", "0", "-fpsprobesize", "0", "-f", "rawvideo", "-pixel_format", "rgba", "-video_size", `${width}x${height}`, "-framerate", String(fps), "-i", `\\\\.\\pipe\\${pipe}-video`,
      "-thread_queue_size", "64", "-probesize", "32", "-analyzeduration", "0", "-f", "wav", "-ignore_length", "1", "-i", `\\\\.\\pipe\\${pipe}-audio`,
      "-map", "0:v:0", "-map", "1:a:0", ...this.encoding(settings, this.encoder),
      "-vf", "vflip,scale=in_range=full:out_range=limited:out_color_matrix=bt709,setparams=range=limited:color_primaries=bt709:color_trc=bt709:colorspace=bt709", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv",
      "-c:a", "aac", "-ar", "48000", "-ac", "2", "-b:a", "192k", "-flags", "+global_header", "-f", "tee",
      `[f=flv:flvflags=no_duration_filesize]rtmp://127.0.0.1:${settings.port}/katarune/live|[f=mp4:movflags=frag_keyframe+empty_moov+default_base_moof]pipe:1`];
    const child = spawn(join(this.resources, "media-supervisor.exe"), args, { windowsHide: true, stdio: "pipe" });
    this.process = child;
    const closed = new Promise<void>(resolve => child.once("close", () => resolve()));
    this.closed = closed;
    const startedAt = Date.now();
    let stage: NonNullable<DiagnosticContext["mediaStage"]> = "server-start";
    const failure = (message: string, context: DiagnosticContext = {}) => new LiveMediaError(message,
      { mediaStage: stage, mediaProcess: "supervisor", durationMs: Date.now() - startedAt, ...context });
    try { await new Promise<void>((resolve, reject) => {
      let buffer = "", frame = false, elapsed = false, hasPreview = false, serverReady = false, encoderStarted = false;
      let settled = false, running = false;
      let knownFailure: LiveMediaError | undefined;
      const cleanup = () => { clearTimeout(timer); signal.removeEventListener("abort", abort); };
      const finish = (error?: Error) => { if (settled) return; settled = true; cleanup(); error ? reject(error) : resolve(); };
      const fail = (error: LiveMediaError) => {
        if (!settled) finish(error);
        else if (running && !this.stopping && !signal.aborted) { running = false; this.onFailure(error); }
      };
      const ready = () => {
        if (settled || knownFailure || this.stopping || signal.aborted || !serverReady || !encoderStarted || !frame || !elapsed || !hasPreview) return;
        running = true;
        diagnostic("info", "live.media-ready", { mediaStage: "output", durationMs: Date.now() - startedAt });
        finish();
      };
      const abort = () => finish(failure("直播启动已取消。"));
      const timer = setTimeout(() => finish(failure(stage === "server-start" ? "本地直播服务未能就绪。" : "直播编码器未能产生有效音视频，请检查输出设置。")), 30_000);
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
      const preview = new Mp4Preview((initialization, fragment) => {
        hasPreview = true;
        this.onPreview({ initialization, fragment, sequence: this.sequence++ }); ready();
      });
      child.stdout.on("data", (bytes: Buffer) => {
        if (this.process !== child || this.stopping || knownFailure) return;
        try { preview.write(bytes); }
        catch { knownFailure = failure("直播预览媒体格式无效。", { mediaStage: "output", mediaProcess: "encoder" }); fail(knownFailure); }
      });
      // Raw stderr is only available to explicit acceptance tests. Production
      // diagnostics retain validated fixed records, never paths or log text.
      const progress = (data: Buffer) => {
        this.acceptanceOutput?.(data.toString("utf8"));
        buffer += data.toString("utf8");
        if (buffer.length > 8192) buffer = buffer.slice(-8192);
        const lines = buffer.split(/\r?\n/); buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (line.startsWith("katarune-media:")) {
            try {
              const record = supervisorRecordSchema.parse(JSON.parse(line.slice("katarune-media:".length)));
              if (record.event === "ready") { serverReady = true; stage = "encoder-start"; }
              else if (record.event === "started") { encoderStarted = true; stage = "output"; }
              else if (record.event === "timeout") knownFailure = failure("本地直播服务启动超时。", { mediaProcess: "server" });
              else if (record.event === "exited") knownFailure ??= failure(record.process === "server" ? "本地直播服务提前退出。" : "直播编码器提前退出。", { mediaProcess: record.process, exitCode: record.code });
              else knownFailure = failure("无法启动直播媒体进程。", { mediaProcess: record.process, ...(record.code === undefined ? {} : { nativeError: record.code }) });
            } catch { knownFailure = failure("直播媒体组件返回了无效状态，请重新准备媒体资源。"); fail(knownFailure); }
          }
          if (/^frame=\s*\d+$/.test(line) && Number(line.slice(6)) >= fps * 3) frame = true;
          if (/^out_time_us=\d+$/.test(line) && Number(line.slice(12)) >= 3_000_000) elapsed = true;
        }
        ready();
      };
      child.stderr.on("data", progress);
      child.once("error", () => fail(failure("无法启动直播媒体进程。")));
      // close follows exit and drains the final structured child failure record.
      child.once("close", code => {
        if (this.process !== child) return;
        if (this.stopping || signal.aborted) { finish(failure("直播启动已取消。")); return; }
        fail(knownFailure ?? failure("直播媒体监督进程已退出。", { exitCode: code ?? -1 }));
      });
    }); } catch (error) { await this.stop(); throw error; }
  }
  stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    const child = this.process, closed = this.closed;
    if (!child || !closed) return Promise.resolve();
    this.stopping = (async () => {
      child.stdin.end();
      const timer = setTimeout(() => { child.kill(); }, 2000);
      let deadline: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([closed, new Promise<never>((_resolve, reject) => {
          deadline = setTimeout(() => reject(new LiveMediaError("直播媒体进程尚未退出，请稍后重试。", { mediaStage: "stop", mediaProcess: "supervisor" })), 10_000);
        })]);
        if (this.process === child) { this.process = undefined; this.closed = undefined; }
      } finally { clearTimeout(timer); clearTimeout(deadline); }
    })().finally(() => { this.stopping = undefined; });
    return this.stopping;
  }
}
