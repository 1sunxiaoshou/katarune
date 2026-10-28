import { projectError, type DiagnosticsApi } from "../../shared/diagnostics";

export function initializeRendererDiagnostics(api: DiagnosticsApi) {
  const report = (event: "renderer.error" | "renderer.rejection" | "renderer.react-error" | "renderer.resize-observer", error: unknown) => {
    try { api.reportDiagnostic({ event, error: projectError(error) }); } catch { /* Logging never breaks the UI. */ }
  };
  window.addEventListener("error", event => report(event.message === "ResizeObserver loop completed with undelivered notifications." || event.message === "ResizeObserver loop limit exceeded" ? "renderer.resize-observer" : "renderer.error", event.error ?? { name: "Error", stack: `Error\n${event.filename}:${event.lineno}:${event.colno}` }));
  window.addEventListener("unhandledrejection", event => report("renderer.rejection", event.reason));
  return { onCaughtError: (error: unknown) => report("renderer.react-error", error), onUncaughtError: (error: unknown) => report("renderer.react-error", error) };
}
