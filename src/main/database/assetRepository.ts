import { asc, eq } from "drizzle-orm";
import { assetSchema, type Asset } from "../../shared/ipc";
import { assets } from "./schema";
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
  };
}
