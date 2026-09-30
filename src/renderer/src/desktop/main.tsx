import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowLeft,
  ChevronsLeft,
  ChevronsRight,
  FolderOpen,
  Keyboard,
  LoaderCircle,
  MessageCircle,
  Mic,
  MicOff,
  MoreHorizontal,
  Move,
  RotateCcw,
  X,
} from "lucide-react";
import type {
  AvatarDesktopApi,
  DesktopCommand,
  DesktopSnapshot,
} from "../../../shared/avatarDesktop";
import { Button } from "@/components/ui/button";
import { Tabs, TabsIndicator, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ModelSelectorContent,
  ModelSelectorGroup,
  ModelSelectorItem,
  ModelSelectorList,
  ModelSelectorRoot,
  ModelSelectorTrigger,
} from "@/components/model-selector";
import { initializeDevicePreferences } from "../settings/devicePreferences";
import "@fontsource-variable/noto-sans-sc";
import "../styles.css";
import "./style.css";
declare global {
  interface Window {
    avatarDesktop: AvatarDesktopApi;
  }
}
const surface = new URLSearchParams(location.search).get("surface");
const command = (operation: DesktopCommand["operation"], value?: string) => {
  void window.avatarDesktop.command({ operation, value });
};
function Icon({
  label,
  children,
  onClick,
  active,
  disabled = false,
}: {
  label: string;
  children: ReactNode;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <Button
      variant={active ? "default" : "ghost"}
      size="icon"
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}
function Choice({
  label,
  value,
  options,
  onChange,
  active,
}: {
  label: string;
  value: string;
  options: { id: string; name: string }[];
  onChange: (value: string) => void;
  active: boolean;
}) {
  const [open, setOpen] = useState(false);
  useLayoutEffect(() => {
    if (!active) setOpen(false);
  }, [active]);
  return (
    <ModelSelectorRoot
      models={options}
      value={value}
      onValueChange={onChange}
      open={active && open}
      onOpenChange={(next) => setOpen(active && next)}
    >
      <ModelSelectorTrigger
        className="desktop-choice-trigger"
        aria-label={label}
      />
      {active && (
        <ModelSelectorContent
          align="end"
          searchable={false}
          className="desktop-choice-content"
        >
          <ModelSelectorList>
            <ModelSelectorGroup>
              {options.map((model) => (
                <ModelSelectorItem key={model.id} model={model} />
              ))}
            </ModelSelectorGroup>
          </ModelSelectorList>
        </ModelSelectorContent>
      )}
    </ModelSelectorRoot>
  );
}
function Desktop() {
  const [state, setState] = useState<DesktopSnapshot>();
  const capsuleRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  useEffect(() => {
    let receivedUpdate = false;
    const off = window.avatarDesktop.subscribe((snapshot) => {
      receivedUpdate = true;
      setState(snapshot);
    });
    void window.avatarDesktop.getState().then((snapshot) => {
      if (!receivedUpdate) setState(snapshot);
    });
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) command("close-panel");
    };
    window.addEventListener("keydown", esc);
    return () => {
      off();
      window.removeEventListener("keydown", esc);
    };
  }, []);
  useLayoutEffect(() => {
    if (surface !== "panel" || state?.panelPhase !== "preparing") return;
    const revision = state.panelRevision;
    // Keep the native window hidden until the new content has had a paint
    // opportunity in its transparent start state. Closing cancels preparation.
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        void window.avatarDesktop.command({
          operation: "panel-ready",
          value: String(revision),
        });
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [state?.panelPhase, state?.panelRevision]);
  useLayoutEffect(() => {
    if (panelRef.current) panelRef.current.scrollTop = 0;
  }, [state?.panel, state?.panelRevision]);
  useEffect(() => {
    const element = capsuleRef.current;
    if (!element) return;
    const reportSize = () => {
      void window.avatarDesktop.command({
        operation: "capsule-size",
        width: Math.max(
          100,
          Math.min(220, element.getBoundingClientRect().width),
        ),
      });
    };
    const observer = new ResizeObserver(reportSize);
    observer.observe(element);
    // CSS dimensions stay constant when crossing monitors, so ResizeObserver
    // alone cannot refresh the physical window region after a DPI change.
    let resolution: MediaQueryList;
    const watchResolution = () => {
      resolution?.removeEventListener("change", watchResolution);
      resolution = matchMedia(`(resolution: ${devicePixelRatio}dppx)`);
      resolution.addEventListener("change", watchResolution);
      reportSize();
    };
    watchResolution();
    return () => {
      observer.disconnect();
      resolution.removeEventListener("change", watchResolution);
    };
  }, [!!state]);
  if (!state) return null;
  const p = state.presentation,
    ready = state.status.phase === "ready",
    error =
      state.error ||
      state.status.error ||
      state.status.voice?.error ||
      p?.error;
  if (surface === "capsule")
    return (
      <div
        ref={capsuleRef}
        className={`capsule ${state.compact ? "compact" : ""}`}
      >
        <Icon
          label={state.compact ? "展开" : "收起"}
          onClick={() => command("compact")}
        >
          {state.compact ? <ChevronsRight /> : <ChevronsLeft />}
        </Icon>
        <span className="capsule-extra" inert={state.compact}>
          <Icon label="打开聊天" onClick={() => command("chat")}>
            <MessageCircle />
          </Icon>
        </span>
        <Icon
          label={state.status.voice?.desired ? "关闭麦克风" : "开启麦克风"}
          disabled={!ready}
          active={!!state.status.voice?.desired}
          onClick={() => command("voice")}
        >
          <span
            className={`voice ${error ? "error" : ""}`}
            style={
              {
                "--level": Math.max(0.12, state.voiceLevel),
              } as React.CSSProperties
            }
          >
            {["preparing", "transcribing", "waiting"].includes(
              state.status.voice?.phase ?? "",
            ) ? (
              <LoaderCircle className="animate-spin" />
            ) : state.status.voice?.desired ? (
              <Mic />
            ) : (
              <MicOff />
            )}
            {state.status.voice?.phase === "recording" && (
              <span className="voice-wave" />
            )}
          </span>
        </Icon>
        <span className="capsule-extra capsule-actions" inert={state.compact}>
          {state.status.phase === "error" ? (
            <Icon
              label={`重试：${error ?? "连接失败"}`}
              onClick={() => command("retry")}
            >
              <RotateCcw className="text-destructive" />
            </Icon>
          ) : (
            <Icon
              label={
                ready
                  ? state.adjusting
                    ? "退出位置调整"
                    : "调整位置"
                  : "正在连接"
              }
              disabled={!ready}
              active={state.adjusting}
              onClick={() => command("adjust")}
            >
              {ready ? <Move /> : <LoaderCircle className="animate-spin" />}
            </Icon>
          )}
          <Icon label="更多" onClick={() => command("panel")}>
            <MoreHorizontal />
          </Icon>
        </span>
      </div>
    );
  const affects: Record<string, string> = {
    neutral: "默认",
    happy: "开心",
    angry: "生气",
    sad: "难过",
    relaxed: "放松",
    surprised: "惊讶",
  };
  return (
    <main
      ref={panelRef}
      className="desktop-panel"
      data-phase={state.panelPhase}
      inert={state.panelPhase !== "open"}
    >
      <header>
        {state.panel === "more" && (
          <span className="model-name">{p?.modelName || "桌宠"}</span>
        )}
        {state.panel === "more" && (
          <>
            <Icon
              label="打开模型"
              disabled={!ready || !!p?.loading}
              onClick={() => command("open-model")}
            >
              <FolderOpen />
            </Icon>
            <Icon
              label="重载模型"
              disabled={!ready || !!p?.loading}
              onClick={() => command("reload-model")}
            >
              {p?.loading ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <RotateCcw />
              )}
            </Icon>
          </>
        )}
        <span className="spacer" />
        <Icon
          label={state.panel === "more" ? "操作说明" : "返回"}
          onClick={() => command("panel", state.panel === "more" ? "help" : "more")}
        >
          {state.panel === "more" ? <Keyboard /> : <ArrowLeft />}
        </Icon>
        <Icon label="关闭面板" onClick={() => command("close-panel")}>
          <X />
        </Icon>
      </header>
      {error && (
        <p className="desktop-error" role="alert">
          {error}
        </p>
      )}
      {state.panel === "more" ? (
        <>
          <Tabs
            className="expressions"
            value={p?.affect ?? null}
            onValueChange={(value) => {
              if (typeof value === "string") command("affect", value);
            }}
          >
            <TabsList aria-label="表情">
              <TabsIndicator className="desktop-expression-indicator" />
              {(state.capabilities?.expressions ?? []).map((affect) => (
                <TabsTrigger key={affect} value={affect}>
                  <span
                    className={`expression-icon expression-icon-${Object.hasOwn(affects, affect) ? affect : "neutral"}`}
                    aria-hidden="true"
                  />
                  {affects[affect] ?? affect}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <div className="control-row">
            <span>动作</span>
            <Choice
              label="动作"
              active={state.panelPhase === "open"}
              value={p?.action || "none"}
              options={[
                { id: "none", name: "无" },
                ...(state.capabilities?.actions ?? []).map((a) => ({
                  id: a.id,
                  name: a.label,
                })),
              ]}
              onChange={(v) => command("action", v)}
            />
          </div>
          <div className="control-row">
            <span>视线追踪</span>
            <Tabs
              className="desktop-segmented"
              value={p?.gaze ? "mouse" : "none"}
              onValueChange={(v) => command("gaze", String(v === "mouse"))}
            >
              <TabsList className="desktop-tabs-list" aria-label="视线追踪">
                <TabsIndicator className="desktop-tabs-indicator" />
                <TabsTrigger value="none">无</TabsTrigger>
                <TabsTrigger value="mouse">鼠标</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          <div className="control-row">
            <span>描边</span>
            <Tabs
              className="desktop-segmented"
              value={p?.outline ? "soft" : "original"}
              onValueChange={(value) =>
                command("outline", String(value === "soft"))
              }
            >
              <TabsList className="desktop-tabs-list" aria-label="描边">
                <TabsIndicator className="desktop-tabs-indicator" />
                <TabsTrigger value="original">默认</TabsTrigger>
                <TabsTrigger value="soft">柔和</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          <div className="control-row">
            <span>角色屏幕</span>
            <Choice
              label="角色屏幕"
              active={state.panelPhase === "open"}
              value={state.selectedDisplay}
              options={state.displays}
              onChange={(v) => command("display", v)}
            />
          </div>
          <div className="control-row">
            <span>布局</span>
            <Button
              className="desktop-reset-button"
              variant="outline"
              aria-label="重置布局"
              onClick={() => command("reset-layout")}
            >
              <RotateCcw />
              重置
            </Button>
          </div>
        </>
      ) : (
        <div className="shortcuts">
          {([
            ["显示／隐藏控制器", "F1"],
            ["关闭面板／退出调整", "Esc"],
            ["旋转角色", <><span className="mouse-icon mouse-left-click" aria-hidden="true" /><Move /></>, "鼠标左键拖动"],
            ["移动角色", <><span className="mouse-icon mouse-middle-click" aria-hidden="true" /><Move /></>, "鼠标中键拖动"],
            ["缩放角色", <span className="mouse-icon mouse-scroll" aria-hidden="true" />, "鼠标滚轮"],
            ["移动控制器", <><span className="mouse-icon mouse-left-click" aria-hidden="true" /><Move /></>, "鼠标左键拖动"],
          ] as [string, ReactNode, string?][]).map(([label, key, keyLabel]) => (
            <div key={label}>
              <span>{label}</span>
              <kbd aria-label={keyLabel}>{key}</kbd>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
initializeDevicePreferences();
window.addEventListener("storage", () => initializeDevicePreferences());
document.documentElement.dataset.surface = surface ?? "panel";
createRoot(document.getElementById("root")!).render(<Desktop />);
