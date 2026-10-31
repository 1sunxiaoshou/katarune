import { z } from "zod";

export type DouyinQrStatus = "waiting" | "scanned" | "confirmed" | "expired" | "verification";
export interface DouyinLoginBrowser {
  readonly fetcher: typeof fetch;
  start(signal: AbortSignal): Promise<{ token: string; url: string; expiresAt: number }>;
  open(cookie: string, signal: AbortSignal): Promise<void>;
  poll(signal: AbortSignal): Promise<DouyinQrStatus>;
  cookie(): Promise<string>;
  showVerification(): void;
  close(): void;
}
export function parseDouyinQr(value: unknown, now: number) {
  const parsed = z.object({ data: z.object({ error_code: z.number().int().optional(), token: z.string().min(1).max(2048), qrcode_index_url: z.url().max(8192), expire_time: z.number().finite().optional() }) }).safeParse(value);
  if (!parsed.success || (parsed.data.data.error_code ?? 0) !== 0) return null;
  const data = parsed.data.data, url = new URL(data.qrcode_index_url);
  if (url.protocol !== "https:" || url.port || url.username || url.password || !["douyin.com", "iesdouyin.com", "amemv.com"].some(domain => url.hostname === domain || url.hostname.endsWith(`.${domain}`))) return null;
  return { token: data.token, url: url.href, expiresAt: Math.min(now + 180000, data.expire_time ? data.expire_time * 1000 : now + 180000) };
}
export function parseDouyinQrStatus(value: unknown): DouyinQrStatus | null {
  const result = z.object({ data: z.object({ error_code: z.number().int().optional(), status: z.union([z.string(), z.number()]).transform(String).optional() }) }).safeParse(value);
  if (!result.success) return null;
  const data = result.data.data;
  if (data.error_code === 2046) return "verification";
  if ((data.error_code ?? 0) !== 0) return null;
  if (["2", "scanned"].includes(data.status ?? "")) return "scanned";
  if (["3", "confirmed"].includes(data.status ?? "")) return "confirmed";
  if (["4", "5", "expired", "refused"].includes(data.status ?? "")) return "expired";
  return ["1", "new"].includes(data.status ?? "") ? "waiting" : null;
}
export function advanceDouyinQrStatus(current: DouyinQrStatus, next: DouyinQrStatus): DouyinQrStatus {
  if (current === "verification" || next === "verification") return "verification";
  if (current === "expired" || current === "confirmed") return current;
  if (current === "scanned" && next === "waiting") return current;
  return next;
}
