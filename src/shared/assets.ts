import * as z from "zod/mini";

export const ASSET_STATUSES = ["ready", "missing"] as const;
export type AssetStatus = (typeof ASSET_STATUSES)[number];

const readyAssetSchema = z.strictObject({
  id: z.uuid(),
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
