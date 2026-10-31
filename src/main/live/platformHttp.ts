import { CookieJar } from "tough-cookie";
import { LiveOperationError } from "./errors";

export const LIVE_WEB_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36";
const MAX_BYTES = 2 * 1024 * 1024;
// An isolated jar per login/connection. Never forward credentials across sites.
export class PlatformHttp {
  readonly jar = new CookieJar();
  constructor(private readonly site: "bilibili.com" | "douyin.com", private readonly fetcher: typeof fetch = fetch) {}
  private allowed(url: URL) {
    return url.protocol === "https:" && (url.hostname === this.site || url.hostname.endsWith(`.${this.site}`)) && !url.port && !url.username && !url.password;
  }
  importCookie(cookie: string, origin: string) {
    if (cookie.length > 16384 || /[\r\n\x00-\x1f\x7f]/.test(cookie)) throw new LiveOperationError("登录凭据格式无效。");
    const url = new URL(origin);
    if (!this.allowed(url)) throw new LiveOperationError("登录凭据来源无效。");
    for (const part of cookie.split(";")) {
      const item = part.trim();
      // Chromium can accept nameless Douyin tracking cookies. They carry no named
      // authentication/device key and cannot be imported into a standards-based jar.
      if (this.site === "douyin.com" && item.startsWith("=")) continue;
      try { if (item) this.jar.setCookieSync(`${item}; Domain=${this.site}; Path=/; Secure`, origin); }
      catch { throw new LiveOperationError("登录凭据格式无效，请重新扫码。"); }
    }
  }
  cookie(origin: string) { return this.jar.getCookieStringSync(origin); }
  async request(input: string, signal: AbortSignal, init: RequestInit = {}): Promise<{ body: string; status: number }> {
    let url = new URL(input);
    for (let hop = 0; hop < 6; hop++) {
      if (!this.allowed(url)) throw new LiveOperationError("平台返回了不允许的登录跳转。");
      const response = await this.fetcher(url.href, { ...init, credentials: "omit", redirect: "manual", signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]), headers: {
        "User-Agent": LIVE_WEB_UA, Referer: `https://www.${this.site}/`, Origin: `https://www.${this.site}`, ...Object.fromEntries(new Headers(init.headers)), Cookie: this.cookie(url.href),
      } });
      for (const cookie of response.headers.getSetCookie()) this.jar.setCookieSync(cookie, url.href, { ignoreError: true });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const target = response.headers.get("location");
        await response.body?.cancel();
        if (!target) throw new LiveOperationError("登录跳转缺少目标地址。");
        url = new URL(target, url);
        init = {}; // Auth callbacks are followed with GET; no request body or custom headers survive.
        continue;
      }
      if (!response.ok) { await response.body?.cancel(); throw new LiveOperationError(`平台请求未成功（HTTP ${response.status}）。`); }
      const reader = response.body?.getReader();
      if (!reader) throw new LiveOperationError("平台没有返回数据。");
      const chunks: Uint8Array[] = []; let size = 0;
      try {
        for (;;) {
          const item = await reader.read(); if (item.done) break;
          size += item.value.byteLength;
          if (size > MAX_BYTES) { await reader.cancel(); throw new LiveOperationError("平台响应超过限制。"); }
          chunks.push(item.value);
        }
      } finally { reader.releaseLock(); }
      return { body: Buffer.concat(chunks).toString("utf8"), status: response.status };
    }
    throw new LiveOperationError("平台登录跳转次数过多。");
  }
  async json(input: string, signal: AbortSignal, init?: RequestInit): Promise<unknown> {
    const response = await this.request(input, signal, init);
    try { return JSON.parse(response.body); }
    catch { throw new LiveOperationError("平台返回了网页验证，请稍后重试；当前未完成登录或连接。"); }
  }
}
