import { randomUUID } from "node:crypto";
import QRCode from "qrcode";
import { z } from "zod";
import { livePlatformImageSchema, liveAccountSchema, type LiveAccount, type LiveLoginState, type LivePlatform } from "../../shared/live";
import type { DatabaseRuntime } from "../database/database";
import type { CredentialStore } from "../security/credentialStore";
import { PlatformHttp } from "./platformHttp";
import { LiveOperationError } from "./errors";
import type { DouyinLoginBrowser } from "./douyinLoginProtocol";

const identifier = z.union([z.string().regex(/^[1-9]\d*$/).max(256), z.number().int().safe().positive()]).transform(String);
export const storedLiveAccountSchema = z.object({ cookie: z.string().max(16384), account: z.optional(liveAccountSchema) });
type Attempt = { state: LiveLoginState; http: PlatformHttp; browser?: DouyinLoginBrowser; key: string; abort: AbortController; busy: boolean; lastPoll: number; verificationDeadline: number };
const ongoing = (value: LiveLoginState) => value.status === "waiting" || value.status === "scanned" || value.status === "verification";
function avatarMetadata(value: unknown): Pick<LiveAccount, "avatarUrl"> {
  const image = z.object({ url_list: z.array(z.string()).max(10) }).safeParse(value);
  for (const url of image.success ? image.data.url_list : [value]) {
    const parsed = livePlatformImageSchema.safeParse(url);
    if (parsed.success) return { avatarUrl: parsed.data };
  }
  return {};
}

export async function validateLiveAccount(platform: LivePlatform, http: PlatformHttp, signal: AbortSignal): Promise<LiveAccount> {
  if (platform === "bilibili") {
    const value = z.object({ code: z.literal(0), data: z.object({ isLogin: z.literal(true), mid: identifier, uname: z.string().min(1).max(256), face: z.unknown().optional() }) })
      .safeParse(await http.json("https://api.bilibili.com/x/web-interface/nav", signal));
    if (!value.success) throw new LiveOperationError("B 站登录态无效，请重新扫码。");
    return { platform, id: value.data.data.mid, name: value.data.data.uname, ...avatarMetadata(value.data.data.face) };
  }
  const value = z.object({ status_code: z.literal(0), data: z.object({ id_str: identifier, nickname: z.string().min(1).max(256), avatar_medium: z.unknown().optional(), avatar_thumb: z.unknown().optional() }) })
    .safeParse(await http.json("https://live.douyin.com/webcast/user/me/?aid=6383", signal));
  if (!value.success) throw new LiveOperationError("抖音账号尚未验证成功，请重新扫码或完成平台验证。");
  return { platform, id: value.data.data.id_str, name: value.data.data.nickname, ...avatarMetadata(value.data.data.avatar_medium ?? value.data.data.avatar_thumb) };
}

export class LiveLoginService {
  private attempt: Attempt | undefined;
  private readonly verifiedAccounts = new Map<LivePlatform, { reference: string; account: LiveAccount }>();
  constructor(private readonly database: Pick<DatabaseRuntime, "getLiveConfig" | "setLiveWebCredentialRef" | "setLiveDouyinCredentialRef">,
    private readonly credentials: CredentialStore, private readonly fetcher: typeof fetch = fetch,
    private readonly now: () => number = Date.now, private readonly douyinBrowser?: () => DouyinLoginBrowser) {}
  private reference(platform: LivePlatform) {
    const config = this.database.getLiveConfig();
    return platform === "bilibili" ? config.webCredentialRef : config.douyinCredentialRef;
  }
  async accounts(): Promise<LiveAccount[]> {
    const result: LiveAccount[] = [];
    for (const platform of ["bilibili", "douyin"] as const) {
      const reference = this.reference(platform);
      if (!reference) continue;
      const stored = storedLiveAccountSchema.parse(JSON.parse(await this.credentials.resolve(reference)));
      if (stored.account?.platform === platform) {
        const verified = this.verifiedAccounts.get(platform);
        result.push(verified?.reference === reference ? verified.account : stored.account);
      }
    }
    return result;
  }
  private async withAccount<T>(platform: LivePlatform, signal: AbortSignal, read: (http: PlatformHttp, account: LiveAccount) => Promise<T>): Promise<T> {
    const reference = this.reference(platform);
    if (!reference) throw new LiveOperationError("请先扫码登录账号。");
    const stored = storedLiveAccountSchema.parse(JSON.parse(await this.credentials.resolve(reference)));
    if (stored.account?.platform !== platform) throw new LiveOperationError("请重新扫码验证当前账号。");
    const browser = platform === "douyin" ? this.douyinBrowser?.() : undefined;
    try {
      if (browser) await browser.open(stored.cookie, signal);
      const http = new PlatformHttp(platform === "bilibili" ? "bilibili.com" : "douyin.com", browser?.fetcher ?? this.fetcher);
      http.importCookie(stored.cookie, platform === "bilibili" ? "https://api.bilibili.com/" : "https://www.douyin.com/");
      const account = await validateLiveAccount(platform, http, signal);
      if (account.id !== stored.account.id) throw new LiveOperationError("账号登录态已变化，请重新扫码。");
      signal.throwIfAborted();
      if (this.reference(platform) !== reference) throw new LiveOperationError("账号登录态已变化，请重新扫码。");
      this.verifiedAccounts.set(platform, { reference, account });
      return await read(http, account);
    } finally { browser?.close(); }
  }
  async refreshAccount(platform: LivePlatform, signal: AbortSignal): Promise<void> {
    await this.withAccount(platform, signal, async () => {});
  }
  async ownRoom(platform: LivePlatform, signal: AbortSignal): Promise<string | null> {
    return this.withAccount(platform, signal, async (http, account) => {
      if (platform === "bilibili") {
        // https://github.com/archibate/qdanmu/blob/master/danmu.py#get_roomid
        const result = z.object({ code: z.literal(0), data: z.object({ roomStatus: z.number().int(), roomid: z.union([z.string().regex(/^\d{1,20}$/), z.number().int().safe().nonnegative()]).transform(String) }) })
          .safeParse(await http.json(`https://api.live.bilibili.com/room/v1/Room/getRoomInfoOld?mid=${encodeURIComponent(account.id)}`, signal));
        if (!result.success) throw new LiveOperationError("暂时无法读取当前账号的直播间，请重新检测。");
        if (result.data.data.roomStatus !== 1 || result.data.data.roomid === "0") return null;
        return result.data.data.roomid;
      }
      // The self-profile room_data contains owner.web_rid while the account is on air.
      // Internal webcast room IDs and the account's display_id are not web_rid.
      const result = z.object({ status_code: z.literal(0), user: z.object({ uid: identifier, room_data: z.union([z.string().max(1024 * 1024), z.object({ owner: z.object({ web_rid: identifier }).nullish() })]).nullish() }) })
        .safeParse(await http.json("https://www.douyin.com/aweme/v1/web/user/profile/self/?device_platform=webapp&aid=6383", signal));
      if (!result.success || result.data.user.uid !== account.id) throw new LiveOperationError("账号已登录，抖音暂未允许读取直播间，请稍后重新检测。");
      const data = result.data.user.room_data;
      if (data == null || (typeof data === "string" && !data.trim())) return null;
      let room: unknown = data;
      if (typeof data === "string") { try { room = JSON.parse(data); } catch { throw new LiveOperationError("抖音返回的直播间信息无效，请稍后重新检测。"); } }
      if (room === null) return null;
      const parsed = z.object({ owner: z.object({ web_rid: z.string().regex(/^[1-9]\d{0,19}$/) }).nullish() }).safeParse(room);
      if (!parsed.success) throw new LiveOperationError("抖音返回的直播间信息无效，请稍后重新检测。");
      return parsed.data.owner?.web_rid ?? null;
    });
  }
  cancel(id?: string) {
    const attempt = this.attempt;
    if (!attempt || (id && id !== attempt.state.id)) return;
    attempt.abort.abort(); attempt.key = "";
    attempt.browser?.close();
    if (ongoing(attempt.state)) attempt.state = { ...attempt.state, status: "cancelled", qrImage: "", message: "登录已取消。" };
  }
  private current(id: string) {
    if (this.attempt?.state.id !== id) throw new LiveOperationError("扫码登录已结束，请重新获取二维码。");
    return this.attempt;
  }
  showVerification(id: string) {
    const attempt = this.current(id);
    if (attempt.state.status !== "verification" || !attempt.browser) throw new LiveOperationError("当前不需要打开平台验证。");
    attempt.browser.showVerification();
  }
  async start(platform: LivePlatform): Promise<LiveLoginState> {
    this.cancel();
    const attempt: Attempt = { state: { id: randomUUID(), platform, status: "waiting", qrImage: "", expiresAt: this.now() + 180000, account: null, message: "请使用对应平台 App 扫码。" },
      http: new PlatformHttp(platform === "bilibili" ? "bilibili.com" : "douyin.com", this.fetcher), key: "", abort: new AbortController(), busy: false, lastPoll: -Infinity, verificationDeadline: this.now() + 300000 };
    this.attempt = attempt;
    const signal = attempt.abort.signal;
    try {
      let url: string;
      if (platform === "douyin" && this.douyinBrowser) {
        attempt.browser = this.douyinBrowser();
        const result = await attempt.browser.start(signal);
        attempt.key = result.token; url = result.url; attempt.state.expiresAt = result.expiresAt;
      } else if (platform === "bilibili") {
        const result = z.object({ code: z.literal(0), data: z.object({ qrcode_key: z.string().min(1).max(256), url: z.url().max(2048) }) })
          .parse(await attempt.http.json("https://passport.bilibili.com/x/passport-login/web/qrcode/generate", signal));
        attempt.key = result.data.qrcode_key; url = result.data.url;
      } else {
        await attempt.http.request("https://www.douyin.com/", signal);
        const response = await attempt.http.json("https://login.douyin.com/passport/web/get_qrcode/?aid=6383&next=https%3A%2F%2Fwww.douyin.com&language=zh&is_new_login=1", signal);
        if (z.object({ data: z.object({ error_code: z.literal(4031) }) }).safeParse(response).success) throw new LiveOperationError("抖音暂时阻止了此次扫码登录（4031），请稍后刷新二维码重试。");
        const result = z.object({ data: z.object({ token: z.string().min(1).max(2048), qrcode_index_url: z.url().max(8192) }) }).safeParse(response);
        if (!result.success) throw new LiveOperationError("抖音未签发二维码，可能需要平台验证，请稍后重试。");
        attempt.key = result.data.data.token; url = result.data.data.qrcode_index_url;
      }
      const target = new URL(url);
      const allowed = platform === "bilibili" ? ["bilibili.com"] : ["douyin.com", "iesdouyin.com", "amemv.com"];
      if (target.protocol !== "https:" || target.port || target.username || target.password || !allowed.some(domain => target.hostname === domain || target.hostname.endsWith(`.${domain}`))) throw new LiveOperationError("平台二维码地址无效。");
      const qrImage = await QRCode.toDataURL(url, { width: 220, margin: 2, errorCorrectionLevel: "M" });
      signal.throwIfAborted(); attempt.state = { ...attempt.state, qrImage };
    } catch (error) {
      if (!signal.aborted) attempt.state = { ...attempt.state, status: "error", message: error instanceof LiveOperationError ? error.message : "二维码获取失败，请稍后重试。" };
      attempt.key = "";
      attempt.browser?.close();
    }
    return { ...attempt.state };
  }
  async poll(id: string): Promise<LiveLoginState> {
    const attempt = this.current(id), signal = attempt.abort.signal;
    if (!ongoing(attempt.state)) return { ...attempt.state };
    if (this.now() >= attempt.state.expiresAt) {
      attempt.state = { ...attempt.state, status: "expired", qrImage: "", message: "二维码已过期，请重新获取。" }; attempt.key = ""; attempt.abort.abort(); attempt.browser?.close();
      return { ...attempt.state };
    }
    if (attempt.busy || this.now() - attempt.lastPoll < 1500) return { ...attempt.state };
    attempt.busy = true; attempt.lastPoll = this.now();
    let verifyingBrowser = false;
    try {
      let confirmed = false, redirect: string | undefined;
      if (attempt.browser) {
        const status = await attempt.browser.poll(signal);
        if (["scanned", "verification", "confirmed"].includes(status)) attempt.state.expiresAt = Math.max(attempt.state.expiresAt, Math.min(this.now() + 180000, attempt.verificationDeadline));
        if (status === "confirmed") confirmed = true;
        else if (status === "expired") attempt.state = { ...attempt.state, status: "expired", message: "二维码已失效，请刷新重试。", qrImage: "" };
        else if (status === "verification") attempt.state = { ...attempt.state, status: "verification", message: "抖音需要本人完成安全验证，请在手机上确认，或打开平台验证窗口。" };
        else if (status === "scanned") attempt.state = { ...attempt.state, status: "scanned", message: "已扫码，请在手机上确认登录。" };
      } else if (attempt.state.platform === "bilibili") {
        const result = z.object({ code: z.literal(0), data: z.object({ code: z.number().int(), url: z.string().max(8192).optional() }) })
          .parse(await attempt.http.json(`https://passport.bilibili.com/x/passport-login/web/qrcode/poll?qrcode_key=${encodeURIComponent(attempt.key)}`, signal));
        if (result.data.code === 86038) attempt.state = { ...attempt.state, status: "expired", message: "二维码已过期。", qrImage: "" };
        else if (result.data.code === 86090) attempt.state = { ...attempt.state, status: "scanned", message: "已扫码，请在手机上确认登录。" };
        else if (result.data.code === 0) confirmed = true;
        else if (result.data.code !== 86101) throw new LiveOperationError("B 站未完成扫码登录，请重新获取二维码。");
        // The web poll response sets the bilibili.com cookies directly. Do not follow biligame redirects carrying credentials.
      } else {
        const result = z.object({ data: z.object({ status: z.union([z.string(), z.number()]).transform(String), redirect_url: z.string().max(8192).optional() }) })
          .safeParse(await attempt.http.json("https://login.douyin.com/passport/web/check_qrconnect/?aid=6383", signal, { method: "POST", body: new URLSearchParams({ token: attempt.key, next: "https://www.douyin.com", is_new_login: "1", is_frontier: "0" }), headers: { "Content-Type": "application/x-www-form-urlencoded" } }));
        if (!result.success) throw new LiveOperationError("抖音扫码状态校验失败，可能需要平台验证。");
        const data = result.data.data;
        if (["2", "scanned"].includes(data.status)) attempt.state = { ...attempt.state, status: "scanned", message: "已扫码，请在手机上确认登录。" };
        if (["3", "confirmed"].includes(data.status) && data.redirect_url) { confirmed = true; redirect = data.redirect_url; }
        else if (["4", "5", "expired", "refused"].includes(data.status)) attempt.state = { ...attempt.state, status: "expired", qrImage: "", message: "二维码已失效，请重新获取。" };
      }
      signal.throwIfAborted();
      if (confirmed) {
        if (redirect) await attempt.http.request(redirect, signal);
        const platform = attempt.state.platform;
        verifyingBrowser = !!attempt.browser;
        const http = attempt.browser ? new PlatformHttp("douyin.com", attempt.browser.fetcher) : attempt.http;
        const account = await validateLiveAccount(platform, http, signal);
        verifyingBrowser = false;
        signal.throwIfAborted();
        const cookie = attempt.browser ? await attempt.browser.cookie() : attempt.http.cookie(platform === "bilibili" ? "https://api.bilibili.com/" : "https://live.douyin.com/");
        const stored = storedLiveAccountSchema.parse({ cookie, account });
        const previous = this.reference(platform), reference = await this.credentials.put(JSON.stringify(stored));
        try {
          signal.throwIfAborted();
          if (platform === "bilibili") this.database.setLiveWebCredentialRef(reference);
          else this.database.setLiveDouyinCredentialRef(reference);
        } catch (error) { await this.credentials.delete(reference); throw error; }
        attempt.state = { ...attempt.state, status: "completed", account, qrImage: "", message: "登录成功。" }; attempt.key = "";
        if (previous) await this.credentials.delete(previous).catch(() => {});
      }
    } catch (error) {
      if (!signal.aborted) attempt.state = verifyingBrowser
        ? { ...attempt.state, status: "scanned", qrImage: "", message: "登录已确认，账号信息仍在核验，请稍候。" }
        : { ...attempt.state, status: "error", qrImage: "", message: error instanceof LiveOperationError ? error.message : "扫码登录失败，请重新获取二维码。" };
      attempt.key = "";
    } finally {
      attempt.busy = false;
      if (!ongoing(attempt.state)) { attempt.key = ""; attempt.abort.abort(); attempt.browser?.close(); }
    }
    return { ...attempt.state };
  }
  async logout(platform: LivePlatform) {
    this.verifiedAccounts.delete(platform);
    if (this.attempt?.state.platform === platform) this.cancel();
    const previous = this.reference(platform);
    if (platform === "bilibili") this.database.setLiveWebCredentialRef(null);
    else this.database.setLiveDouyinCredentialRef(null);
    if (previous) await this.credentials.delete(previous);
  }
}
