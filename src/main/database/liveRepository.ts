import { eq } from "drizzle-orm";
import { DEFAULT_LIVE_SETTINGS, liveSettingsSchema, type LiveSettings } from "../../shared/live";
import { liveSettings } from "./schema";
import type { KataruneDatabase } from "./types";

export function createLiveRepository(database: KataruneDatabase) {
  const ensure = () => database.insert(liveSettings).values({ id: 1, config: DEFAULT_LIVE_SETTINGS }).onConflictDoNothing().run();
  return {
    getLiveConfig(): { settings: LiveSettings; credentialRef: string | null; webCredentialRef: string | null } {
      ensure();
      const row = database.select().from(liveSettings).where(eq(liveSettings.id, 1)).get();
      if (!row) throw new Error("直播配置不存在。");
      return { settings: liveSettingsSchema.parse(row.config), credentialRef: row.credentialRef, webCredentialRef: row.webCredentialRef };
    },
    saveLiveConfig(settings: LiveSettings) {
      ensure();
      database.update(liveSettings).set({ config: liveSettingsSchema.parse(settings) }).where(eq(liveSettings.id, 1)).run();
    },
    clearLiveConnection() {
      ensure();
      const row = database.select().from(liveSettings).where(eq(liveSettings.id, 1)).get();
      if (!row) throw new Error("直播配置不存在。");
      database.update(liveSettings).set({ credentialRef: null, webCredentialRef: null,
        config: { ...liveSettingsSchema.parse(row.config), connectionMode: "official", webRoomId: "" },
      }).where(eq(liveSettings.id, 1)).run();
    },
    setLiveCredentialRef(credentialRef: string) {
      ensure();
      database.update(liveSettings).set({ credentialRef }).where(eq(liveSettings.id, 1)).run();
    },
    setLiveWebCredentialRef(webCredentialRef: string | null) {
      ensure();
      database.update(liveSettings).set({ webCredentialRef }).where(eq(liveSettings.id, 1)).run();
    },
  };
}
