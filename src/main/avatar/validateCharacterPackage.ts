import { spawn } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import type { RuntimeCharacterPackage } from "../../shared/characterPackages";

export async function validateCharacterPackage(
  executable: string,
  pack: RuntimeCharacterPackage,
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted();
  const stage = await mkdtemp(join(tmpdir(), "katarune-package-validation-"));
  try {
    const input = join(stage, "package.json");
    const output = join(stage, "result.json");
    await writeFile(input, JSON.stringify(pack));
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        executable,
        [
          "-batchmode",
          "-nographics",
          "--validate-package",
          input,
          "--validation-result",
          output,
          "-logFile",
          join(stage, "validation.log"),
        ],
        {
          cwd: dirname(executable),
          windowsHide: true,
          stdio: "ignore",
          env: {
            ...process.env,
            KATARUNE_AVATAR_PIPE: "",
            KATARUNE_CHARACTER_PACKAGE: "",
          },
        },
      );
      let failure: Error | undefined;
      const abort = () => {
        failure =
          signal.reason instanceof Error
            ? signal.reason
            : new Error("验证已取消。");
        child.kill();
      };
      const timer = setTimeout(() => {
        failure = new Error("Unity 角色包验证超时。");
        child.kill();
      }, 120_000);
      signal.addEventListener("abort", abort, { once: true });
      child.once("error", (error) => {
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        reject(error);
      });
      child.once("exit", () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        failure ? reject(failure) : resolve();
      });
      if (signal.aborted) abort();
    });
    const report = JSON.parse(await readFile(output, "utf8")) as {
      ok: boolean;
      error?: string;
    };
    if (!report.ok) throw new Error(report.error || "Unity 角色包验证失败。");
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}
