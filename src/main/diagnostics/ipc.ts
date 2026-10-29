import { ipcMain } from "electron";
import { randomUUID } from "node:crypto";
import { diagnostic, withDiagnosticContext } from "./logger";
import { projectError } from "../../shared/diagnostics";
import { OperationRejected } from "./operationRejected";

/** Explicit registration adapter: observes invoke failures without inspecting payloads. */
export const diagnosticIpcMain = {
  handle(channel: string, listener: Parameters<typeof ipcMain.handle>[1]) {
    ipcMain.handle(channel, async (event, ...args: unknown[]) => {
      const operationId = randomUUID(), started = performance.now();
      diagnostic("debug", `ipc.${channel.replaceAll(":", ".")}.started`, { operationId });
      try {
        const result: unknown = await withDiagnosticContext({ operationId }, () => listener(event, ...args));
        diagnostic("debug", `ipc.${channel.replaceAll(":", ".")}.completed`, { operationId, durationMs: performance.now() - started });
        return result;
      } catch (error) {
        if (error instanceof OperationRejected) {
          diagnostic("warn", `ipc.${channel.replaceAll(":", ".")}.rejected`, { operationId, durationMs: performance.now() - started, outcome: "rejected", reasonCode: error.reasonCode });
          const publicError = new Error(`${error.message}（原因码：${error.reasonCode}）`);
          publicError.stack = `Error: ${publicError.message}`;
          throw publicError;
        }
        const safe = projectError(error), cancelled = safe.name === "AbortError";
        const incidentId = diagnostic(cancelled ? "info" : "error", `ipc.${channel.replaceAll(":", ".")}.${cancelled ? "cancelled" : "failed"}`, { operationId, durationMs: performance.now() - started }, cancelled ? undefined : error);
        const message = cancelled ? "操作已取消。" : safe.code === "ENOSPC" || safe.code === "SQLITE_FULL" ? "磁盘空间不足，请清理后重试。"
          : safe.code === "EACCES" || safe.code === "EPERM" ? "无法访问所需文件，请检查权限。" : "操作失败，请稍后重试。";
        // Electron prints invoke rejections to its console. Never let it inspect
        // the original error/cause or print absolute stack locations.
        const publicError = new Error(`${message}${incidentId ? `（故障编号：${incidentId}）` : ""}`);
        publicError.stack = `Error: ${publicError.message}`;
        throw publicError;
      }
    });
  },
};
