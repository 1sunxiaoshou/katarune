import { app, dialog, ipcMain, shell, type WebContents } from "electron";
import { randomUUID } from "node:crypto";
import { readdir, readFile, writeFile, lstat } from "node:fs/promises";
import { join } from "node:path";
import * as z from "zod/mini";
import { DIAGNOSTICS_CHANNELS, diagnosticExportSchema, rendererDiagnosticSchema, diagnosticRecordSchema, projectError } from "../../shared/diagnostics";
import type { Diagnostics } from "./logger";

export function registerDiagnosticsHandlers(logger: Diagnostics) {
  const sources = new Map<number, { instance: string; tokens: number; updated: number; dropped: number }>();
  const trusted = new Set<WebContents>();
  app.on("web-contents-created", (_event, contents) => {
    // Only app windows with the configured preload participate, never remote/webview content.
    if (contents.getType() !== "window") return;
    trusted.add(contents);
    sources.set(contents.id, { instance: randomUUID(), tokens: 100, updated: Date.now(), dropped: 0 });
    contents.once("destroyed", () => { trusted.delete(contents); sources.delete(contents.id); });
    contents.on("render-process-gone", (_event, detail) => {
      logger.record(detail.reason === "clean-exit" ? "info" : "error", "renderer.process-gone", { exitCode: detail.exitCode, reason: detail.reason, processKind: "renderer" },
        undefined, "renderer", sources.get(contents.id)?.instance);
      const source = sources.get(contents.id); if (source) source.instance = randomUUID();
    });
    contents.on("preload-error", (_event, _path, error) => logger.record("error", "preload.error", {}, error));
  });
  const allowed = (event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent) => trusted.has(event.sender) && event.senderFrame === event.sender.mainFrame;
  ipcMain.on(DIAGNOSTICS_CHANNELS.report, (event, value: unknown) => {
    if (!allowed(event)) return;
    const source = sources.get(event.sender.id); if (!source) return;
    const now = Date.now(); source.tokens = Math.min(100, source.tokens + (now - source.updated) * .02); source.updated = now;
    if (source.tokens < 1) { source.dropped++; return; }
    source.tokens--;
    const parsed = rendererDiagnosticSchema.safeParse(value); if (!parsed.success) return;
    if (source.dropped) { logger.record("warn", "diagnostics.source-dropped", { count: source.dropped }, undefined, "renderer", source.instance); source.dropped = 0; }
    const error = parsed.data.error;
    logger.record(parsed.data.event === "renderer.resize-observer" ? "warn" : "error", parsed.data.event, {}, { name: error.name, code: error.code,
      statusCode: error.httpStatus, isRetryable: error.retryable, stack: `Error\n${error.frames.join("\n")}` }, "renderer", source.instance);
  });
  ipcMain.handle(DIAGNOSTICS_CHANNELS.status, event => { if (!allowed(event)) throw new Error("诊断请求不可用。"); return logger.status(); });
  ipcMain.handle(DIAGNOSTICS_CHANNELS.debug, (event, value: unknown) => {
    if (!allowed(event)) throw new Error("诊断请求不可用。"); return logger.debug(z.boolean().parse(value));
  });
  ipcMain.handle(DIAGNOSTICS_CHANNELS.open, async event => {
    if (!allowed(event)) return { status: "error" };
    try { return { status: await shell.openPath(logger.directory) ? "error" : "success" }; } catch { return { status: "error" }; }
  });
  let exporting = false;
  ipcMain.handle(DIAGNOSTICS_CHANNELS.export, async (event, value: unknown) => {
    if (!allowed(event) || exporting) return { status: "error" };
    const request = diagnosticExportSchema.safeParse(value); if (!request.success) return { status: "error" };
    exporting = true;
    try {
      await logger.flush();
      const cutoff = Date.now() - request.data.hours * 3600_000;
      const events = new Map<string, unknown>();
      const collect = (line: string) => {
        if (Buffer.byteLength(line) > 8192) return;
        try {
          const parsed = diagnosticRecordSchema.safeParse(JSON.parse(line));
          if (!parsed.success) return;
          const entry = parsed.data;
          if (entry.error) entry.error = entry.error.map(error => projectError({ name: error.name, code: error.code, statusCode: error.httpStatus, isRetryable: error.retryable, stack: `Error\n${error.frames.join("\n")}` }));
          if (Date.parse(entry.timestamp) >= cutoff) events.set(`${entry.bootId}:${entry.sequence}`, entry);
        } catch { /* Ignore a partial last line after interrupted writes. */ }
      };
      let remaining = 50 * 1024 * 1024;
      for (const name of (await readdir(logger.directory).catch(() => [])).filter(name => /^events(?:-\d+-\d+)?\.jsonl$/.test(name))) {
        const path = join(logger.directory, name), info = await lstat(path);
        if (!info.isFile() || info.isSymbolicLink() || info.size > remaining || info.size > 6 * 1024 * 1024) continue;
        remaining -= info.size;
        for (const line of (await readFile(path, "utf8")).split("\n")) collect(line);
      }
      for (const line of logger.memorySnapshot()) collect(line);
      const body = JSON.stringify({ manifest: { schemaVersion: 1, exportedAt: new Date().toISOString(), hours: request.data.hours,
        appVersion: app.getVersion(), electronVersion: process.versions.electron, unityVersion: "6000.3.11f1", platform: process.platform,
        events: events.size, diagnostics: logger.status(), excludes: ["credentials", "conversations", "media", "database", "raw-engine-logs", "crash-dumps"] }, events: [...events.values()] }, null, 2);
      const confirmation = await dialog.showMessageBox({ type: "info", buttons: ["保存诊断", "取消"], cancelId: 1, defaultId: 0,
        message: "导出本地诊断", detail: `最近 ${request.data.hours} 小时，${events.size} 条事件，约 ${(Buffer.byteLength(body) / 1024).toFixed(0)} KB。包含版本、运行状态和已脱敏错误信息，不含聊天内容、音频或密钥。文件仅保存到你选择的位置。` });
      if (confirmation.response !== 0) return { status: "cancelled" };
      const target = await dialog.showSaveDialog({ title: "保存诊断", defaultPath: `Katarune-diagnostics-${new Date().toISOString().slice(0, 10)}.json`, filters: [{ name: "诊断文件", extensions: ["json"] }] });
      if (target.canceled || !target.filePath) return { status: "cancelled" };
      await writeFile(target.filePath, body, { mode: 0o600 });
      logger.record("info", "diagnostics.exported", { count: events.size });
      return { status: "success" };
    } catch (error) { logger.record("warn", "diagnostics.export-failed", {}, error); return { status: "error" }; }
    finally { exporting = false; }
  });
}
