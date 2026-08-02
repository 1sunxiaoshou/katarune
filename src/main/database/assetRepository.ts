import { and, asc, eq, isNull, notExists } from "drizzle-orm";
import { assetSchema, type Asset } from "../../shared/ipc";
import { assets, messageAssets } from "./schema";
import type {
  AssetRepository,
  AssetMetadata,
  KataruneDatabase,
} from "./types";

export function createAssetRepository(
  database: KataruneDatabase,
): AssetRepository {
  const fetchAsset = (id: string): Asset => {
    const asset = database
      .select({
        id: assets.id,
        kind: assets.kind,
        status: assets.status,
        mimeType: assets.mimeType,
        byteSize: assets.byteSize,
        sha256: assets.sha256,
        originalName: assets.originalName,
        createdAt: assets.createdAt,
        updatedAt: assets.updatedAt,
      })
      .from(assets)
      .where(eq(assets.id, id))
      .get();
    if (asset === undefined) {
      throw new Error(`Asset "${id}" was not found.`);
    }
    return assetSchema.parse(asset);
  };

  return {
    fetchAsset,
    listAssets: () =>
      database
        .select({ id: assets.id })
        .from(assets)
        .orderBy(asc(assets.createdAt))
        .all()
        .map(({ id }) => fetchAsset(id)),
    markAssetReady: (id, metadata: AssetMetadata) => {
      const result = database
        .update(assets)
        .set({ ...metadata, status: "ready", updatedAt: new Date() })
        .where(eq(assets.id, id))
        .run();
      if (result.changes === 0) fetchAsset(id);
      return fetchAsset(id);
    },
    registerReadyAsset: (asset) => {
      const now = new Date();
      database
        .insert(assets)
        .values({ ...asset, status: "ready", createdAt: now, updatedAt: now })
        .run();
      return fetchAsset(asset.id);
    },
    deleteUnreferencedChatAttachment: (id) => {
      const result = database
        .delete(assets)
        .where(
          and(
            eq(assets.id, id),
            eq(assets.kind, "chat_attachment"),
            notExists(
              database
                .select({ assetId: messageAssets.assetId })
                .from(messageAssets)
                .where(eq(messageAssets.assetId, assets.id)),
            ),
          ),
        )
        .run();
      return result.changes > 0;
    },
    listUnreferencedChatAttachmentIds: () =>
      database
        .select({ id: assets.id })
        .from(assets)
        .leftJoin(messageAssets, eq(messageAssets.assetId, assets.id))
        .where(
          and(
            eq(assets.kind, "chat_attachment"),
            isNull(messageAssets.messageId),
          ),
        )
        .orderBy(asc(assets.createdAt))
        .all()
        .map(({ id }) => id),
  };
}
