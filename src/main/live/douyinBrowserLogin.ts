import { randomUUID } from "node:crypto";
import { BrowserWindow, session, type Session } from "electron";
import { z } from "zod";
import { LiveOperationError } from "./errors";
import { advanceDouyinQrStatus, parseDouyinQr, parseDouyinQrStatus, type DouyinLoginBrowser, type DouyinQrStatus } from "./douyinLoginProtocol";

const HOME = "https://www.douyin.com";
const LOGIN_PAGE = `${HOME}/login_page?service=${encodeURIComponent(HOME)}`;
const MAX_BODY = 2 * 1024 * 1024;
const allowed = (url: URL) => url.protocol === "https:" && !url.port && !url.username && !url.password && (url.hostname === "douyin.com" || url.hostname.endsWith(".douyin.com"));
const responseSchema = z.object({ requestId: z.string().max(256), response: z.object({ url: z.string().max(16384), status: z.number().int() }) });
const requestSchema = z.object({ requestId: z.string().max(256), request: z.object({ url: z.string().max(16384), postData: z.string().max(16384).optional() }) });

async function bounded<T>(promise: Promise<T>, signal: AbortSignal, ms = 35000): Promise<T> {
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const abort = () => { cleanup(); reject(signal.reason); };
    const timer = setTimeout(() => { cleanup(); reject(new LiveOperationError("抖音登录页面加载超时，请重试。")); }, ms);
    const cleanup = () => { clearTimeout(timer); signal.removeEventListener("abort", abort); };
    signal.addEventListener("abort", abort, { once: true });
    promise.then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
  });
}

/** Official page runs in an ephemeral sandbox. It never receives our preload or IPC. */
export class DouyinBrowserLogin implements DouyinLoginBrowser {
  private window: BrowserWindow | undefined;
  private session: Session | undefined;
  private readonly lifetime = new AbortController();
  private opening: Promise<void> | undefined;
  private token = "";
  private status: DouyinQrStatus = "waiting";
  private qr: ReturnType<typeof parseDouyinQr> = null;
  private qrReady: (() => void) | undefined;
  private requests = new Map<string, { path: string; token: string }>();
  private responses = new Set<string>();
  private removeAbort: (() => void) | undefined;
  private closed = false;

  async open(cookie: string, signal: AbortSignal) {
    if (!this.opening) this.opening = this.initialize(cookie, signal);
    await this.opening;
  }
  private async initialize(cookie: string, signal: AbortSignal) {
    const combined = AbortSignal.any([signal, this.lifetime.signal]);
    const isolated = session.fromPartition(`douyin-login-${randomUUID()}`, { cache: false });
    this.session = isolated;
    isolated.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    isolated.setPermissionCheckHandler(() => false);
    isolated.on("will-download", event => event.preventDefault());
    isolated.webRequest.onBeforeRequest((details, callback) => callback({ cancel: details.resourceType === "media" }));
    if (cookie.length > 16384 || /[\r\n\x00-\x1f\x7f]/.test(cookie)) throw new LiveOperationError("抖音登录凭据格式无效。");
    for (const part of cookie.split(";")) {
      combined.throwIfAborted();
      const separator = part.indexOf("=");
      if (separator < 1) continue;
      const name = part.slice(0, separator).trim(), value = part.slice(separator + 1).trim();
      if (!name) continue;
      await isolated.cookies.set({ url: HOME, domain: ".douyin.com", name, value, path: "/", secure: true, httpOnly: name === "sessionid" || name === "sessionid_ss" });
    }
    combined.throwIfAborted();
    const window = new BrowserWindow({ show: false, width: 960, height: 720, title: "抖音账号验证", autoHideMenuBar: true,
      webPreferences: { session: isolated, nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, backgroundThrottling: false } });
    this.window = window;
    window.webContents.setAudioMuted(true);
    window.webContents.setUserAgent(`Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`);
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    const navigation = (event: Electron.Event, url: string) => { try { if (!allowed(new URL(url))) event.preventDefault(); } catch { event.preventDefault(); } };
    window.webContents.on("will-navigate", navigation); window.webContents.on("will-redirect", navigation);
    window.on("closed", () => { this.window = undefined; this.lifetime.abort(); });
    const cancel = () => this.close(); combined.addEventListener("abort", cancel, { once: true });
    this.removeAbort = () => combined.removeEventListener("abort", cancel);
    // CDP commands may remain pending before the first navigation (Electron Debugger docs).
    await bounded(window.loadURL("about:blank"), combined);
    window.webContents.debugger.attach("1.3");
    window.webContents.debugger.on("message", (_event, method: string, params: unknown) => { void this.observe(method, params).catch(() => {}); });
    await bounded(window.webContents.debugger.sendCommand("Network.enable", { maxTotalBufferSize: 4 * MAX_BODY, maxResourceBufferSize: MAX_BODY }), combined);
    await bounded(window.loadURL(LOGIN_PAGE), combined);
  }
  private async observe(method: string, params: unknown) {
    if (!this.window || this.lifetime.signal.aborted) return;
    if (method === "Network.requestWillBeSent") {
      const parsed = requestSchema.safeParse(params); if (!parsed.success) return;
      const { requestId, request } = parsed.data, url = new URL(request.url);
      if (!allowed(url) || !["/passport/web/get_qrcode", "/passport/web/check_qrconnect"].includes(url.pathname.replace(/\/$/, ""))) return;
      this.requests.set(requestId, { path: url.pathname, token: new URLSearchParams(request.postData ?? url.search).get("token") ?? "" });
      while (this.requests.size > 128) {
        const oldest = this.requests.keys().next().value!;
        this.requests.delete(oldest); this.responses.delete(oldest);
      }
    } else if (method === "Network.responseReceived") {
      const parsed = responseSchema.safeParse(params);
      if (parsed.success && this.requests.has(parsed.data.requestId) && parsed.data.response.status >= 200 && parsed.data.response.status < 300 && allowed(new URL(parsed.data.response.url))) this.responses.add(parsed.data.requestId);
    } else if (method === "Network.loadingFinished") {
      const parsed = z.object({ requestId: z.string() }).safeParse(params); if (!parsed.success) return;
      const id = parsed.data.requestId, request = this.requests.get(id);
      if (!request || !this.responses.delete(id)) return;
      this.requests.delete(id);
      const result: unknown = await this.window.webContents.debugger.sendCommand("Network.getResponseBody", { requestId: id });
      const body = z.object({ body: z.string().max(MAX_BODY), base64Encoded: z.boolean().optional() }).parse(result);
      if (body.base64Encoded || this.lifetime.signal.aborted) return;
      const value: unknown = JSON.parse(body.body);
      if (request.path.includes("get_qrcode")) {
        const qr = parseDouyinQr(value, Date.now()); if (!qr) return;
        if (this.token && this.token !== qr.token) { this.status = advanceDouyinQrStatus(this.status, "expired"); return; }
        this.qr = qr; this.token = qr.token; this.qrReady?.();
      } else if (this.token && request.token === this.token) {
        const status = parseDouyinQrStatus(value);
        if (status) this.status = advanceDouyinQrStatus(this.status, status);
      }
    } else if (method === "Network.loadingFailed") {
      const parsed = z.object({ requestId: z.string() }).safeParse(params);
      if (parsed.success) { this.requests.delete(parsed.data.requestId); this.responses.delete(parsed.data.requestId); }
    }
  }
  async start(signal: AbortSignal) {
    const combined = AbortSignal.any([signal, this.lifetime.signal]);
    const ready = new Promise<void>(resolve => { this.qrReady = resolve; });
    // Start navigation and wait for the actual QR response, without waiting for media assets.
    void this.open("", signal).catch(() => this.close());
    await bounded(ready, combined);
    this.qrReady = undefined;
    if (!this.qr) throw new LiveOperationError("抖音没有返回可用二维码。");
    return this.qr;
  }
  async poll(signal: AbortSignal): Promise<DouyinQrStatus> {
    signal.throwIfAborted(); this.lifetime.signal.throwIfAborted();
    const cookies = await this.session?.cookies.get({ url: HOME });
    // The official page handles frontier WebSocket confirmations and callback exchanges.
    // Cookie presence only triggers a separate authenticated account check in LiveLoginService.
    if (cookies?.some(cookie => ["sessionid", "sessionid_ss"].includes(cookie.name) && cookie.value)) return "confirmed";
    return this.status;
  }
  async cookie() {
    const cookies = await this.session?.cookies.get({ url: HOME }) ?? [];
    const header = cookies.filter(cookie => cookie.name && (cookie.domain === "douyin.com" || cookie.domain?.endsWith(".douyin.com"))).map(cookie => `${cookie.name}=${cookie.value}`).join("; ");
    if (header.length > 16384) throw new LiveOperationError("抖音登录凭据超过限制，请重新登录。");
    return header;
  }
  readonly fetcher: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? String(input) : input.url);
    if (!allowed(url) || !["/webcast/user/me/", "/aweme/v1/web/user/profile/self/"].includes(url.pathname) || (init?.method ?? "GET") !== "GET") throw new LiveOperationError("不允许的抖音账号查询。");
    const window = this.window; if (!window) throw new LiveOperationError("抖音登录页面已关闭。");
    const signal = init?.signal ? AbortSignal.any([init.signal, this.lifetime.signal]) : this.lifetime.signal;
    const result: unknown = await bounded(window.webContents.executeJavaScript(`(async()=>{const c=new AbortController();const timer=setTimeout(()=>c.abort(),12000);try{const r=await fetch(${JSON.stringify(url.href)},{credentials:'include',redirect:'error',signal:c.signal});const reader=r.body.getReader();const chunks=[];let size=0;for(;;){const v=await reader.read();if(v.done)break;size+=v.value.byteLength;if(size>${MAX_BODY}){await reader.cancel();throw new Error('Response limit');}chunks.push(v.value);}const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return {status:r.status,body:new TextDecoder().decode(bytes)};}finally{clearTimeout(timer);}})()`), signal, 15000);
    const value = z.object({ status: z.number().int().min(200).max(599), body: z.string().max(MAX_BODY) }).parse(result);
    return new Response(value.body, { status: value.status });
  };
  showVerification() { if (this.window && this.status === "verification") { this.window.show(); this.window.focus(); } }
  close() {
    if (this.closed) return; this.closed = true;
    this.removeAbort?.(); this.removeAbort = undefined;
    if (!this.lifetime.signal.aborted) this.lifetime.abort();
    const window = this.window; this.window = undefined;
    if (window && !window.isDestroyed()) window.destroy();
    this.requests.clear(); this.responses.clear(); this.token = ""; this.qr = null; this.qrReady = undefined;
    const isolated = this.session; this.session = undefined;
    void (this.opening ?? Promise.resolve()).catch(() => {}).then(() => isolated?.clearStorageData()).catch(() => {});
  }
}
