import { readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";
const directory = resolve(process.argv[2]);
const jsonl = async name => (await readFile(join(directory, name), "utf8")).trim().split("\n").map(JSON.parse);
const frames = await jsonl("frames.jsonl");
const blocks = await jsonl("audio.jsonl");
const source = await readFile(join(directory, "audio.f32"));
const rate = Number(await readFile(join(directory, "sample-rate.txt"), "utf8"));
const start = frames[0].time, end = frames.at(-1).time;
const pcm = Buffer.alloc(Math.ceil((end - start + .05) * rate) * 4);
for (const block of blocks) {
  for (let n = 0; n < block.samples / block.channels; n++) {
    const target = Math.round((block.time - start) * rate) + n;
    if (target < 0 || (target + 1) * 4 > pcm.length) continue;
    const offset = (block.offset + n * block.channels) * 4;
    if (offset + block.channels * 4 > source.length) break;
    let sum = 0;
    for (let c = 0; c < block.channels; c++) sum += source.readFloatLE(offset + c * 4);
    pcm.writeFloatLE(sum / block.channels, target * 4);
  }
}
await writeFile(join(directory, "timeline.f32"), pcm);
await writeFile(join(directory, "frames.ffconcat"), "ffconcat version 1.0\n" + frames.map((frame, i) =>
  `file '${frame.file}'\nduration ${Math.max(.001, (frames[i + 1]?.time ?? end + .033) - frame.time)}\n`).join(""));
// Compare output RMS and the sum of the behavior system's applied vowels, on the same DSP clock.
function rms(t) {
  let sum = 0, count = 0;
  const first = Math.round((t - start - .01) * rate);
  for (let i = first; i < first + rate * .02; i++) if (i >= 0 && (i + 1) * 4 <= pcm.length) {
    sum += pcm.readFloatLE(i * 4) ** 2; count++;
  }
  return count ? Math.sqrt(sum / count) : 0;
}
let best = { lagMs: 0, correlation: -1 };
for (let lagMs = -250; lagMs <= 250; lagMs += 5) {
  const pairs = frames.filter(f => f.position > .1).map(f => [Math.min(1, rms(f.time - lagMs / 1000) / .04), f.aa + f.ih + f.ou + f.ee + f.oh]);
  const a = pairs.reduce((s, p) => s + p[0], 0) / pairs.length, b = pairs.reduce((s, p) => s + p[1], 0) / pairs.length;
  const covariance = pairs.reduce((s, p) => s + (p[0] - a) * (p[1] - b), 0);
  const variance = Math.sqrt(pairs.reduce((s, p) => s + (p[0] - a) ** 2, 0) * pairs.reduce((s, p) => s + (p[1] - b) ** 2, 0));
  const correlation = covariance / variance;
  if (correlation > best.correlation) best = { lagMs, correlation };
}
const fixtures = JSON.parse(await readFile(join(directory, "speech-fixtures.json"), "utf8").catch(() => "{}"));
function subtitleAt(artifact, position) {
  if (!artifact.segments?.length) return artifact.text;
  const pages = [];
  for (const segment of artifact.segments) {
    let page = pages.at(-1);
    if (!page || page.text.length + segment.text.length > 48) { page = { text: "", start: segment.startSeconds, end: segment.endSeconds }; pages.push(page); }
    if (/[A-Za-z0-9]$/.test(page.text) && /^[A-Za-z0-9]/.test(segment.text)) page.text += " ";
    page.text += segment.text; page.end = segment.endSeconds;
  }
  return pages.find(page => position >= page.start && position < page.end)?.text ?? "";
}
let subtitleFrames = 0, subtitleBeyondOneFrame = 0, stoppedPoseResiduals = 0;
for (let i = 1; i < frames.length; i++) {
  const f = frames[i], previous = frames[i - 1], artifact = fixtures[f.playbackId];
  if (artifact && f.position > .1 && f.playbackId === previous.playbackId) {
    subtitleFrames++;
    if (f.subtitle !== subtitleAt(artifact, f.position) && f.subtitle !== subtitleAt(artifact, previous.position)) subtitleBeyondOneFrame++;
  }
  if (!f.playbackId && "playbackId" in f && [f.aa, f.ih, f.ou, f.ee, f.oh].some(value => value !== 0)) stoppedPoseResiduals++;
}
const report = { frames: frames.length, duration: end - start, engineEnvelopeLag: best,
  subtitleFrames, subtitleBeyondOneFrame, stoppedPoseResiduals,
  vowelMaxima: Object.fromEntries(["aa", "ih", "ou", "ee", "oh"].map(key => [key, Math.max(...frames.map(f => f[key]))])),
  note: "Envelope correlation is a diagnostic of engine output, not phoneme alignment or measured sound-card latency." };
await writeFile(join(directory, "sync-report.json"), JSON.stringify(report, null, 2));
const result = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-safe", "0", "-i", join(directory, "frames.ffconcat"),
  "-f", "f32le", "-ar", String(rate), "-ac", "1", "-i", join(directory, "timeline.f32"),
  "-vf", "pad=ceil(iw/2)*2:ceil(ih/2)*2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-fps_mode", "vfr", "-c:a", "aac", "-shortest", join(directory, "preview.mp4")], { stdio: "inherit", windowsHide: true });
if (result.status !== 0) throw new Error("FFmpeg capture encoding failed");
console.log(JSON.stringify(report));
