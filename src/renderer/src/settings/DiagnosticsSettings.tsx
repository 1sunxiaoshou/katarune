import { useState } from "react";
import { Button } from "@/components/ui/button";
import { notify } from "../notifications";

export function DiagnosticsSettings() {
  const [opening, setOpening] = useState(false);
  const openDirectory = async () => {
    setOpening(true);
    try {
      const result = await window.katarune.openDiagnostics();
      if (result.status === "error") throw new Error("open-failed");
    } catch {
      notify({ level: "error", message: "无法打开日志目录，请稍后重试。", dedupeKey: "open-diagnostics-error" });
    } finally {
      setOpening(false);
    }
  };

  return (
    <div className="flex min-h-16 items-center justify-between gap-3 border-t pt-6">
      <span className="text-sm font-medium text-foreground-secondary">日志</span>
      <Button
        type="button"
        variant="outline"
        data-testid="open-diagnostics"
        disabled={opening}
        onClick={() => void openDirectory()}
      >
        打开日志
      </Button>
    </div>
  );
}
