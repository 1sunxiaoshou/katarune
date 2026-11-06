import { useEffect, useState } from "react";
import { ExternalLinkIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { KATARUNE_PROJECT_URL, type AppUpdateState } from "../../../shared/appUpdates";

function updateMessage(state: AppUpdateState | undefined): string {
  switch (state?.status) {
    case "checking": return "正在检查更新…";
    case "latest": return "当前已是最新版本。";
    case "check-failed": return "无法检查更新，请稍后重试。";
    case "available": return `发现新版本 v${state.version}`;
    case "downloading": return state.percent === null ? "正在准备下载…" : `正在下载 ${state.percent}%`;
    case "download-failed": return "无法准备更新安装包，请重试。";
    case "installing": return "正在准备安装…";
    default: return "";
  }
}

const actionLabels: Partial<Record<AppUpdateState["status"], string>> = {
  available: "更新",
  "download-failed": "更新",
  checking: "检查中…",
  downloading: "下载中…",
  installing: "准备安装…",
};

export function AboutSettings() {
  const [version, setVersion] = useState<string>();
  const [update, setUpdate] = useState<AppUpdateState>();
  const [requestFailed, setRequestFailed] = useState(false);
  const [showLatest, setShowLatest] = useState(false);

  useEffect(() => {
    let active = true;
    let receivedChange = false;
    let latestTimer: number | undefined;
    const unsubscribe = window.katarune.onAppUpdateChanged((state) => {
      receivedChange = true;
      setUpdate(state);
      setRequestFailed(false);
      window.clearTimeout(latestTimer);
      setShowLatest(state.status === "latest");
      if (state.status === "latest") latestTimer = window.setTimeout(() => setShowLatest(false), 3000);
    });
    void window.katarune.getAppInfo().then((info) => {
      if (active) setVersion(info.version);
    }).catch(() => { /* Keep the brand visible if the version cannot be read. */ });
    void window.katarune.openAppUpdatePage().then((state) => {
      if (active && !receivedChange) setUpdate(state);
    }).catch(() => {
      if (active && !receivedChange) setUpdate({ status: "check-failed" });
    });
    return () => { active = false; unsubscribe(); window.clearTimeout(latestTimer); };
  }, []);

  const status = update?.status;
  const canDownload = status === "available" || status === "download-failed";
  const busy = status === "checking" || status === "downloading" || status === "installing";
  const label = actionLabels[status ?? "idle"] ?? "检查更新";
  const message = requestFailed ? "操作失败，请稍后重试。" : status === "latest" && !showLatest ? "" : updateMessage(update);

  const run = async () => {
    setRequestFailed(false);
    try {
      if (canDownload) await window.katarune.applyAppUpdate();
      else await window.katarune.checkAppUpdate();
    } catch {
      setRequestFailed(true);
    }
  };

  return (
    <section className="grid min-h-full w-full content-center justify-items-center border bg-card px-4 pt-6 pb-10 text-center sm:px-8" aria-label="关于 Katarune" data-testid="about-settings">
      <img src="./katarune-logo.png" alt="" className="size-32 sm:size-36" draggable={false} />
      <div className="relative mt-1 flex flex-wrap items-baseline justify-center gap-x-2">
        <h2 className="text-[2.25rem] leading-tight sm:text-[2.75rem]" style={{ fontFamily: '"Segoe Print", var(--font-name-reading)' }}>Katarune</h2>
        {version && (
          <span className="shrink-0 rounded-full bg-[#efeade] px-2.5 py-0.5 text-xs font-semibold text-[#796a50] tabular-nums sm:absolute sm:bottom-2 sm:left-full sm:ml-2 dark:bg-[#393226] dark:text-[#e3d7be]" data-testid="about-version">
            v{version}
          </span>
        )}
      </div>
      <div className="mt-7 grid justify-items-center gap-1.5">
        <Button type="button" variant={canDownload ? "default" : "outline"} disabled={!update || busy || status === "unavailable"} onClick={() => void run()} data-testid="about-update-action">
          {label}
        </Button>
        <p role="status" className={`min-h-5 text-xs ${requestFailed || status === "check-failed" || status === "download-failed" ? "text-destructive" : "text-muted-foreground"}`} data-testid="about-update-status">
          {message}
        </p>
      </div>
      <a href={KATARUNE_PROJECT_URL} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1.5 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
        GitHub<ExternalLinkIcon aria-hidden="true" className="size-3" />
      </a>
    </section>
  );
}
