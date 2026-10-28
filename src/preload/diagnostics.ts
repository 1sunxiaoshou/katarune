import { ipcRenderer } from "electron";
import { DIAGNOSTICS_CHANNELS, diagnosticActionSchema, diagnosticExportSchema, diagnosticStatusSchema,
  rendererDiagnosticSchema, type DiagnosticsApi } from "../shared/diagnostics";

export const diagnosticsApi: DiagnosticsApi = {
  reportDiagnostic: value => { const parsed = rendererDiagnosticSchema.safeParse(value); if (parsed.success) ipcRenderer.send(DIAGNOSTICS_CHANNELS.report, parsed.data); },
  getDiagnosticsStatus: async () => diagnosticStatusSchema.parse(await ipcRenderer.invoke(DIAGNOSTICS_CHANNELS.status)),
  setDiagnosticsDebug: async enabled => diagnosticStatusSchema.parse(await ipcRenderer.invoke(DIAGNOSTICS_CHANNELS.debug, enabled)),
  openDiagnostics: async () => diagnosticActionSchema.parse(await ipcRenderer.invoke(DIAGNOSTICS_CHANNELS.open)),
  exportDiagnostics: async request => diagnosticActionSchema.parse(await ipcRenderer.invoke(DIAGNOSTICS_CHANNELS.export, diagnosticExportSchema.parse(request))),
};
// Main observes Electron's preload-error event. Window error events can cross
// isolated-world boundaries, so registering here would duplicate page errors.
