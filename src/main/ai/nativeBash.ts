import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { StringDecoder } from "node:string_decoder";

export function findNativeBash(): string | null {
  if (process.platform !== "win32") return existsSync("/bin/bash") ? "/bin/bash" : null;
  const roots = [process.env.ProgramFiles, process.env["ProgramFiles(x86)"]].filter((value): value is string => Boolean(value));
  const candidates = roots.map(root => join(root, "Git", "bin", "bash.exe"));
  if (process.env.LOCALAPPDATA) candidates.push(join(process.env.LOCALAPPDATA, "Programs", "Git", "bin", "bash.exe"));
  for (const path of (process.env.PATH ?? "").split(delimiter)) {
    if (existsSync(join(path, "git.exe"))) candidates.push(join(dirname(path), "bin", "bash.exe"));
  }
  return candidates.find(path => existsSync(path)) ?? null;
}

export function runNativeBash(shell: string, command: string, cwd: string, signal?: AbortSignal): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(shell, ["--noprofile", "--norc", "-c", command], { cwd, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32" });
    let stdout = "", stderr = "", bytes = 0;
    const outDecoder = new StringDecoder("utf8"), errDecoder = new StringDecoder("utf8");
    let failure: Error | undefined;
    const terminate = () => {
      if (!child.pid) return;
      if (process.platform === "win32") {
        const killer = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
        killer.on("error", () => child.kill());
      } else {
        try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); }
      }
    };
    const cancel = () => { if (failure) return; failure = new Error("命令已取消或超时。"); terminate(); };
    signal?.addEventListener("abort", cancel, { once: true });
    const collect = (chunk: Buffer, error: boolean) => {
      if (failure) return;
      bytes += chunk.length;
      if (bytes > 8 * 1024 * 1024) { failure = new Error("命令输出超过 8 MiB，已停止。"); terminate(); return; }
      if (error) stderr += errDecoder.write(chunk); else stdout += outDecoder.write(chunk);
    };
    child.stdout.on("data", (chunk: Buffer) => collect(chunk, false));
    child.stderr.on("data", (chunk: Buffer) => collect(chunk, true));
    child.once("error", error => { signal?.removeEventListener("abort", cancel); reject(error); });
    child.once("close", code => {
      stdout += outDecoder.end(); stderr += errDecoder.end();
      signal?.removeEventListener("abort", cancel);
      if (failure) reject(failure); else resolve({ stdout, stderr, exitCode: code ?? 1 });
    });
    if (signal?.aborted) cancel();
  });
}
