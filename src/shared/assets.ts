import * as z from "zod/mini";

export const ASSET_STATUSES = ["ready", "missing"] as const;
export type AssetStatus = (typeof ASSET_STATUSES)[number];

export const ASSET_KINDS = [
  "character_portrait",
  "character_vrm",
  "chat_attachment",
] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

export const CHAT_ATTACHMENT_LIMITS = Object.freeze({
  maxFileBytes: 25 * 1024 * 1024,
  maxFilesPerMessage: 10,
  maxTotalBytesPerMessage: 50 * 1024 * 1024,
});

export const DEFAULT_ATTACHMENT_MEDIA_TYPE = "application/octet-stream";

const readyAssetSchema = z.strictObject({
  id: z.uuid(),
  kind: z.enum(ASSET_KINDS),
  status: z.literal("ready"),
  mimeType: z.string().check(z.minLength(1), z.maxLength(255)),
  byteSize: z.int().check(z.nonnegative()),
  sha256: z.string().check(z.regex(/^[a-f0-9]{64}$/)),
  originalName: z.string().check(z.minLength(1), z.maxLength(255)),
  createdAt: z.date(),
  updatedAt: z.date(),
});

const missingAssetSchema = z.strictObject({
  id: z.uuid(),
  kind: z.enum(ASSET_KINDS),
  status: z.literal("missing"),
  mimeType: z.null(),
  byteSize: z.null(),
  sha256: z.null(),
  originalName: z.null(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const assetSchema = z.discriminatedUnion("status", [
  readyAssetSchema,
  missingAssetSchema,
]);

export type Asset = Readonly<z.infer<typeof assetSchema>>;

export const assetUrl = (assetId: string): string =>
  `katarune-asset://asset/${encodeURIComponent(assetId)}`;

export function parseAssetUrl(value: string | URL): string | null {
  let url: URL;
  try {
    url = typeof value === "string" ? new URL(value) : value;
  } catch {
    return null;
  }
  if (
    url.protocol !== "katarune-asset:" ||
    url.hostname !== "asset" ||
    url.username !== "" ||
    url.password !== "" ||
    url.port !== "" ||
    url.search !== "" ||
    url.hash !== "" ||
    !/^\/[0-9a-f-]{36}$/i.test(url.pathname)
  ) {
    return null;
  }
  const assetId = url.pathname.slice(1);
  return z.uuid().safeParse(assetId).success ? assetId : null;
}

export const stagedAssetUrl = (stageId: string): string =>
  `katarune-asset://staged/${encodeURIComponent(stageId)}`;
