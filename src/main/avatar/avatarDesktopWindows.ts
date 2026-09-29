import { DESKTOP_CHANNELS } from "../../shared/avatarDesktopChannels";
import {
  BrowserWindow,
  dialog,
  globalShortcut,
  ipcMain,
  screen,
  type Display,
  type Rectangle,
} from "electron";
import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  desktopCommandSchema,
  type DesktopCommand,
  type DesktopSnapshot,
  type DesktopSurface,
  type AvatarWindowReport,
} from "../../shared/avatarDesktop";
import type { AvatarService } from "./avatarService";

type Placement = { display: string; x: number; y: number; height: number };
type Preferences = {
  version: 2;
  role: Placement;
  capsule: Placement;
  yaw: number;
  pitch: number;
  gaze: boolean;
  outline: boolean;
};
const CAPSULE_WIDTH = 240;
const CAPSULE_HEIGHT = 64;
const rounded = (r: Rectangle): Rectangle => ({
  x: Math.round(r.x),
  y: Math.round(r.y),
  width: Math.round(r.width),
  height: Math.round(r.height),
});

/** Owns desktop layout in DIP. Unity alone applies physical bounds to its HWND. */
export class AvatarDesktopWindows {
  private windows = new Map<DesktopSurface, BrowserWindow>();
  private prefs: Preferences;
  private file: string;
  private initialized = false;
  private adjusting = false;
  private compact = false;
  private hidden = false;
  private panelView: DesktopSnapshot["panel"] = "more";
  private panelRevision = 0;
  private panelPhase: DesktopSnapshot["panelPhase"] = "closed";
  private layoutId = "";
  private hasSavedLayout = false;
  private capsuleWidth = 220;
  private error: string | null = null;
  private dialogOpen = false;
  private pendingLayout:
    | { id: string; timer: ReturnType<typeof setTimeout> }
    | undefined;
  private publishTimer: ReturnType<typeof setTimeout> | undefined;
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;
  private lastInputZones = "";
  constructor(
    private avatar: AvatarService,
    directory: string,
  ) {
    this.file = join(directory, "avatar-desktop-layout.json");
    const display = screen.getPrimaryDisplay();
    this.prefs = this.defaults(display);
    try {
      const saved: unknown = JSON.parse(readFileSync(this.file, "utf8"));
      if (this.validPreferences(saved)) {
        this.prefs = {
          version: 2, role: saved.role, capsule: saved.capsule,
          yaw: saved.yaw, pitch: saved.pitch,
          gaze: saved.gaze, outline: saved.outline,
        };
        this.hasSavedLayout = true;
      }
    } catch {
      /* First launch or an interrupted/invalid preference file uses defaults. */
    }
    this.reconcileDisplays();
    avatar.onDesktopChanged = () => this.changed();
    avatar.onWindowState = (state) => this.windowReport(state);
    ipcMain.handle(DESKTOP_CHANNELS.get, (event) => {
      const surface = this.surfaceFor(event.sender);
      return this.snapshot(surface);
    });
    ipcMain.handle(DESKTOP_CHANNELS.command, async (event, value: unknown) => {
      const surface = this.surfaceFor(event.sender);
      try {
        const command = desktopCommandSchema.parse(value);
        if (
          command.operation === "capsule-size" ||
          command.operation === "panel-ready"
        ) {
          await this.command(surface, command);
          return;
        }
        this.error = null;
        await this.command(surface, command);
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error);
      }
      this.publish();
    });
    screen.on("display-added", this.displaysChanged);
    screen.on("display-removed", this.displaysChanged);
    screen.on("display-metrics-changed", this.displaysChanged);
  }
  private validPreferences(value: unknown): value is Preferences {
    if (!value || typeof value !== "object") return false;
    const p = value as Preferences;
    return (
      p.version === 2 &&
      [p.yaw, p.pitch].every(Number.isFinite) &&
      typeof p.gaze === "boolean" &&
      typeof p.outline === "boolean" &&
      [p.role, p.capsule].every(
        (r) =>
          r &&
          typeof r.display === "string" &&
          [r.x, r.y, r.height].every(Number.isFinite) &&
          r.height > 0 &&
          r.height <= 100,
      )
    );
  }
  private defaults(d: Display): Preferences {
    const area = d.workArea;
    const inset = 16;
    const role = { display: String(d.id), x: 0.78, y: 0.5, height: 0.65 };
    const capsule = this.inside(
      {
        x: area.x + area.width - CAPSULE_WIDTH - inset,
        y: area.y + area.height - CAPSULE_HEIGHT - inset,
        width: CAPSULE_WIDTH,
        height: CAPSULE_HEIGHT,
      },
      {
        x: area.x + inset,
        y: area.y + inset,
        width: area.width - inset * 2,
        height: area.height - inset * 2,
      },
    );
    return {
      version: 2,
      role,
      capsule: {
        display: String(d.id),
        x: (capsule.x + CAPSULE_WIDTH / 2 - area.x) / area.width,
        y: (capsule.y + CAPSULE_HEIGHT / 2 - area.y) / area.height,
        height: 1,
      },
      yaw: 0,
      pitch: 4,
      gaze: false,
      outline: true,
    };
  }
  private display(id?: string): Display {
    id ??= this.prefs.role.display;
    return (
      screen.getAllDisplays().find((d) => String(d.id) === id) ??
      screen.getPrimaryDisplay()
    );
  }
  private reconcileDisplays(): void {
    const ids = screen.getAllDisplays().map((d) => String(d.id));
    const fallback = this.defaults(screen.getPrimaryDisplay());
    if (!ids.includes(this.prefs.role.display)) {
      this.prefs.role.display = fallback.role.display;
    }
    if (!ids.includes(this.prefs.capsule.display))
      this.prefs.capsule = fallback.capsule;
  }
  private displaysChanged = (): void => {
    this.reconcileDisplays();
    if (this.initialized) this.sendLayout();
    const capsule = this.windows.get("capsule");
    if (capsule) capsule.setBounds(this.capsuleBounds());
    this.positionPanel();
    this.saveSoon();
    this.publish();
  };
  private physicalRoleBounds(): Rectangle {
    const bounds = this.display().bounds;
    const first = screen.dipToScreenPoint({ x: bounds.x, y: bounds.y });
    const last = screen.dipToScreenPoint({
      x: bounds.x + bounds.width - 1,
      y: bounds.y + bounds.height - 1,
    });
    return {
      x: first.x,
      y: first.y,
      width: last.x - first.x + 1,
      height: last.y - first.y + 1,
    };
  }
  private capsuleBounds(): Rectangle {
    const a = this.display(this.prefs.capsule.display).workArea;
    const width = CAPSULE_WIDTH,
      height = CAPSULE_HEIGHT;
    return rounded({
      x: a.x + a.width * this.prefs.capsule.x - width / 2,
      y: a.y + a.height * this.prefs.capsule.y - height / 2,
      width,
      height,
    });
  }
  private updateCapsuleShape(window: BrowserWindow): void {
    // setShape clips drawing AND input. Electron converts these DIP rectangles
    // to a physical HRGN. The renderer reports both size and committed DPR changes.
    // Window movement and sizing remain owned by the OS.
    if (process.platform !== "win32" && process.platform !== "linux") return;
    window.setShape(
      Array.from({ length: CAPSULE_HEIGHT }, (_, y) => {
        const dy = Math.abs(y + 0.5 - 32);
        const inset = Math.ceil(32 - Math.sqrt(32 * 32 - dy * dy));
        return {
          x: inset,
          y,
          width: Math.round(this.capsuleWidth) + 20 - inset * 2,
          height: 1,
        };
      }),
    );
  }
  private inside(r: Rectangle, area: Rectangle): Rectangle {
    const scale = Math.min(1, area.width / r.width, area.height / r.height);
    r = {
      ...r,
      width: Math.round(r.width * scale),
      height: Math.round(r.height * scale),
    };
    return rounded({
      ...r,
      x: Math.max(area.x, Math.min(r.x, area.x + area.width - r.width)),
      y: Math.max(area.y, Math.min(r.y, area.y + area.height - r.height)),
    });
  }
  private create(surface: DesktopSurface): BrowserWindow {
    const window = new BrowserWindow({
      width: surface === "panel" ? 320 : CAPSULE_WIDTH,
      height: surface === "panel" ? 410 : CAPSULE_HEIGHT,
      show: false,
      frame: false,
      transparent: true,
      hasShadow: false,
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      type: "toolbar",
      focusable: true,
      alwaysOnTop: true,
      webPreferences: {
        preload: join(__dirname, "../preload/desktop.cjs"),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    });
    window.setMenu(null);
    window.setAlwaysOnTop(true, "pop-up-menu");
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (e) => e.preventDefault());
    if (surface === "capsule") {
      this.updateCapsuleShape(window);
      window.on("will-move", () => {
        this.hidePanel();
      });
      window.on("moved", () => {
        this.remember(
          this.prefs.capsule,
          window.getBounds(),
          screen.getDisplayMatching(window.getBounds()),
        );
        this.hasSavedLayout = true;
        this.saveSoon();
        this.publish();
      });
    }
    this.windows.set(surface, window);
    const url = process.env.ELECTRON_RENDERER_URL;
    if (url) void window.loadURL(`${url}/desktop.html?surface=${surface}`);
    else
      void window.loadFile(join(__dirname, "../renderer/desktop.html"), {
        query: { surface },
      });
    window.once("ready-to-show", () => {
      if (surface === "capsule" && !this.hidden) window.showInactive();
      this.publish();
      this.restack();
    });
    window.on("move", () => this.syncInputZones());
    window.on("resize", () => this.syncInputZones());
    window.on("show", () => this.syncInputZones());
    window.on("hide", () => this.syncInputZones());
    window.on("restore", () => this.restack());
    window.on("show", () => this.restack());
    window.on("focus", () => this.restack());
    if (surface === "panel")
      window.on("blur", () => {
        // Electron dispatches blur asynchronously. A stale blur must not
        // dismiss a panel that has already been reopened/focused. A click on
        // the capsule is handled by its button, rather than racing that click.
        if (
          this.dialogOpen ||
          !window.isVisible() ||
          window.isFocused() ||
          this.windows.get("capsule")?.isFocused()
        )
          return;
        this.hidePanel();
      });
    return window;
  }
  private changed(): void {
    if (this.disposed) return;
    const phase = this.avatar.status.phase;
    if (phase === "stopped") {
      this.closeWindows();
      return;
    }
    if (!this.windows.size) {
      this.create("capsule").setBounds(this.capsuleBounds());
      this.create("panel");
      if (
        !globalShortcut.register("F1", () => {
          this.hidden = !this.hidden;
          if (this.hidden) {
            this.windows.get("capsule")?.hide();
            this.closePanel();
          } else {
            this.windows.get("capsule")?.showInactive();
            this.restack();
          }
        })
      )
        this.error = "F1 已被其他应用占用。";
    }
    if (
      phase === "ready" &&
      !this.initialized &&
      this.avatar.presentation &&
      !this.avatar.presentation.loading &&
      this.avatar.presentation.modelPath
    ) {
      this.initialized = true;
      if (!this.hasSavedLayout) {
        this.prefs = this.defaults(this.display());
        this.windows.get("capsule")?.setBounds(this.capsuleBounds());
        this.hasSavedLayout = true;
      }
      this.sendLayout();
      void this.avatar
        .desktopCommand("gaze", String(this.prefs.gaze))
        .catch((e) => this.operationError(e));
      void this.avatar
        .desktopCommand("outline", String(this.prefs.outline))
        .catch((e) => this.operationError(e));
    }
    if (phase === "error") {
      this.initialized = false;
      this.adjusting = false;
      this.lastInputZones = "";
      this.cancelLayout();
    }
    if (!this.publishTimer)
      this.publishTimer = setTimeout(() => {
        this.publishTimer = undefined;
        this.publish();
      }, 50);
  }
  private operationError(error: unknown): void {
    this.error = error instanceof Error ? error.message : String(error);
    this.publish();
  }
  private snapshot(surface: DesktopSurface = "panel"): DesktopSnapshot {
    return {
      status: { ...this.avatar.status, binding: null },
      capabilities:
        surface === "panel" ? this.avatar.desktopCapabilities : null,
      presentation:
        surface === "panel" && this.avatar.presentation
          ? { ...this.avatar.presentation, modelPath: "" }
          : null,
      displays: screen.getAllDisplays().map((d, index) => ({
        id: String(d.id), name: d.label || `屏幕 ${index + 1}`,
      })),
      selectedDisplay: this.prefs.role.display,
      adjusting: this.adjusting,
      compact: this.compact,
      voiceLevel: this.avatar.inputLevel,
      panel: this.panelView,
      panelRevision: this.panelRevision,
      panelPhase: this.panelPhase,
      error: this.error,
    };
  }
  private publish(): void {
    for (const [surface, w] of this.windows)
      if (!w.isDestroyed())
        w.webContents.send(DESKTOP_CHANNELS.state, this.snapshot(surface));
  }
  private surfaceFor(contents: Electron.WebContents): DesktopSurface {
    for (const [surface, w] of this.windows)
      if (w.webContents === contents) return surface;
    throw new Error("不允许的桌宠窗口来源。");
  }
  private restack(): void {
    for (const surface of ["capsule", "panel"] as const) {
      const w = this.windows.get(surface);
      if (w?.isVisible()) {
        if (!w.isAlwaysOnTop()) w.setAlwaysOnTop(true, "pop-up-menu");
        w.moveTop();
      }
    }
  }
  private syncInputZones(): void {
    if (!this.initialized) return;
    const rects = (["capsule", "panel"] as const)
      .map((surface) => this.windows.get(surface))
      .filter((window): window is BrowserWindow => !!window && window.isVisible())
      .map((window) => screen.dipToScreenRect(null, window.getBounds()));
    const value = JSON.stringify(rects);
    if (value === this.lastInputZones) return;
    this.lastInputZones = value;
    this.avatar.sendWindowInputZones(rects);
  }
  private cancelLayout(): void {
    if (this.pendingLayout) clearTimeout(this.pendingLayout.timer);
    this.pendingLayout = undefined;
  }
  private sendLayout(includeGeometry = true): void {
    if (!this.initialized) return;
    this.cancelLayout();
    const id = randomUUID();
    this.layoutId = id;
    this.pendingLayout = {
      id,
      timer: setTimeout(() => {
        this.pendingLayout = undefined;
        this.avatar.failDesktop("桌宠窗口未响应，请重试。");
      }, 5000),
    };
    this.avatar.sendWindowLayout({
      requestId: id,
      applyGeometry: includeGeometry,
      ...(includeGeometry
        ? {
            rect: this.physicalRoleBounds(),
            yaw: this.prefs.yaw,
            pitch: this.prefs.pitch,
            x: this.prefs.role.x,
            y: this.prefs.role.y,
            height: this.prefs.role.height,
          }
        : {}),
      adjusting: this.adjusting,
    });
    this.syncInputZones();
  }
  private windowReport(state: AvatarWindowReport): void {
    if (!this.initialized || state.layoutId !== this.layoutId) return;
    if (state.requestId) {
      if (state.requestId !== this.pendingLayout?.id) return;
      this.cancelLayout();
      this.restack();
    } else if (this.pendingLayout) return;
    if (state.restored) this.restack();
    // Only explicit user edits change the saved in-Unity composition.
    if (state.userChanged && !state.requestId) {
      this.prefs.yaw = state.yaw;
      this.prefs.pitch = state.pitch;
      this.prefs.role.x = state.x;
      this.prefs.role.y = state.y;
      this.prefs.role.height = state.height;
      this.saveSoon();
    }
    if (this.adjusting && !state.adjusting) this.closePanel();
    this.publish();
  }
  private remember(
    placement: Placement,
    rect: Rectangle,
    display: Display,
  ): void {
    const area = display.workArea;
    placement.display = String(display.id);
    placement.x = (rect.x + rect.width / 2 - area.x) / area.width;
    placement.y = (rect.y + rect.height / 2 - area.y) / area.height;
  }
  private positionPanel(): void {
    const capsule = this.windows.get("capsule"),
      panel = this.windows.get("panel");
    if (!capsule || !panel) return;
    const c = capsule.getBounds(),
      a = screen.getDisplayMatching(c).workArea;
    const height = Math.min(410, a.height - 24);
    panel.setBounds(
      this.inside(
        {
          x: c.x + c.width - 320,
          y: c.y - height - 8 >= a.y ? c.y - height - 8 : c.y + c.height + 8,
          width: Math.min(320, a.width - 24),
          height,
        },
        a,
      ),
    );
  }
  private updateEscapeShortcut(): void {
    globalShortcut.unregister("Escape");
    if (this.adjusting)
      globalShortcut.register("Escape", () => this.closePanel());
  }
  private hidePanel(): void {
    const changed = this.panelPhase !== "closed";
    this.panelPhase = "closed";
    this.windows.get("panel")?.hide();
    if (changed) this.publish();
  }
  private setAdjusting(adjusting: boolean): void {
    if (this.adjusting === adjusting) return;
    this.adjusting = adjusting;
    this.updateEscapeShortcut();
    // Input mode changes must not round-trip the native position through DIP.
    this.sendLayout(false);
  }
  private closePanel(): void {
    this.hidePanel();
    this.setAdjusting(false);
    this.publish();
  }
  private async command(
    surface: DesktopSurface,
    c: DesktopCommand,
  ): Promise<void> {
    const allowed: Record<
      DesktopSurface,
      readonly DesktopCommand["operation"][]
    > = {
      capsule: [
        "chat",
        "voice",
        "retry",
        "stop",
        "panel",
        "close-panel",
        "adjust",
        "compact",
        "capsule-size",
      ],
      panel: [
        "panel",
        "panel-ready",
        "close-panel",
        "reset-layout",
        "display",
        "open-model",
        "reload-model",
        "affect",
        "action",
        "gaze",
        "outline",
      ],
    };
    if (!allowed[surface].includes(c.operation))
      throw new Error("此窗口不支持该操作。");
    const value = c.value ?? "";
    switch (c.operation) {
      case "chat":
        this.avatar.onOpenChat?.();
        break;
      case "voice":
        this.avatar.setVoiceDesired(!this.avatar.status.voice?.desired);
        break;
      case "retry": {
        const binding = this.avatar.status.binding;
        if (binding) await this.avatar.start(binding);
        break;
      }
      case "stop":
        this.avatar.stop();
        break;
      case "compact":
        this.compact = !this.compact;
        this.closePanel();
        break;
      case "capsule-size":
        this.capsuleWidth = c.width ?? (this.compact ? 100 : 220);
        this.updateCapsuleShape(this.windows.get("capsule")!);
        break;
      case "close-panel":
        this.closePanel();
        break;
      case "adjust":
        this.hidePanel();
        this.setAdjusting(!this.adjusting);
        break;
      case "panel-ready": {
        const panel = this.windows.get("panel");
        if (
          !panel ||
          this.panelPhase !== "preparing" ||
          value !== String(this.panelRevision)
        )
          return;
        if (!this.windows.get("capsule")?.isFocused() && !panel.isFocused()) {
          // The user may leave while the hidden renderer prepares its frame.
          this.hidePanel();
          return;
        }
        panel.show();
        this.panelPhase = "open";
        this.publish();
        break;
      }
      case "panel": {
        const view = value === "help" ? "help" : "more";
        if (
          this.panelPhase !== "closed" &&
          this.panelView === view &&
          surface === "capsule"
        ) {
          this.hidePanel();
          break;
        }
        this.panelView = view;
        if (this.panelPhase === "closed") {
          this.panelRevision++;
          this.panelPhase = "preparing";
          this.positionPanel();
        }
        this.publish();
        break;
      }
      case "reset-layout": {
        const defaults = this.defaults(this.display());
        Object.assign(this.prefs, {
          role: defaults.role,
          capsule: defaults.capsule,
          yaw: 0,
          pitch: 4,
        });
        this.windows.get("capsule")?.setBounds(this.capsuleBounds());
        this.sendLayout();
        this.positionPanel();
        this.saveSoon();
        break;
      }
      case "display": {
        const target = screen.getAllDisplays().find((d) => String(d.id) === value);
        if (!target) throw new Error("所选屏幕已断开。");
        this.prefs.role.display = value;
        this.sendLayout();
        this.saveSoon();
        break;
      }
      case "open-model": {
        this.dialogOpen = true;
        try {
          const result = await dialog.showOpenDialog(
            this.windows.get("panel")!,
            {
              title: "打开 VRM 模型",
              properties: ["openFile"],
              filters: [{ name: "VRM", extensions: ["vrm"] }],
            },
          );
          if (!result.canceled && result.filePaths[0])
            await this.avatar.desktopCommand("load-model", result.filePaths[0]);
        } finally {
          this.dialogOpen = false;
        }
        break;
      }
      case "reload-model": {
        const path = this.avatar.presentation?.modelPath;
        if (path) await this.avatar.desktopCommand("load-model", path);
        break;
      }
      case "affect":
      case "action":
        await this.avatar.desktopCommand(`desktop-${c.operation}`, value);
        break;
      case "gaze":
      case "outline":
        await this.avatar.desktopCommand(c.operation, value);
        this.prefs[c.operation] = value === "true";
        this.saveSoon();
        break;
    }
  }
  private saveSoon(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = undefined;
      this.save();
    }, 400);
  }
  private save(): void {
    try {
      writeFileSync(`${this.file}.tmp`, JSON.stringify(this.prefs));
      renameSync(`${this.file}.tmp`, this.file);
    } catch (error) {
      this.operationError(error);
    }
  }
  private closeWindows(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = undefined;
      this.save();
    }
    this.cancelLayout();
    this.initialized = false;
    this.layoutId = "";
    this.lastInputZones = "";
    this.adjusting = false;
    this.hidden = false;
    this.panelPhase = "closed";
    globalShortcut.unregister("F1");
    globalShortcut.unregister("Escape");
    if (this.publishTimer) clearTimeout(this.publishTimer);
    this.publishTimer = undefined;
    for (const w of this.windows.values()) if (!w.isDestroyed()) w.destroy();
    this.windows.clear();
  }
  dispose(): void {
    this.disposed = true;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.save();
    this.closeWindows();
    this.avatar.onDesktopChanged = undefined;
    this.avatar.onWindowState = undefined;
    ipcMain.removeHandler(DESKTOP_CHANNELS.get);
    ipcMain.removeHandler(DESKTOP_CHANNELS.command);
    screen.removeListener("display-added", this.displaysChanged);
    screen.removeListener("display-removed", this.displaysChanged);
    screen.removeListener("display-metrics-changed", this.displaysChanged);
  }
}
