import type BetterSqlite3 from "better-sqlite3";
import { readMigrationFiles } from "drizzle-orm/migrator";

// The local attachment migration ran before its journal timestamp changed on merge.
// Its SQL is identical. Retire this repair only when that development history is unsupported.
export function reconcileAttachmentMigrationHistory(
  sqlite: BetterSqlite3.Database,
  migrationsFolder: string,
): void {
  const hash = "6a84178de374807e4565e5f6d9346f718a248e98dff0bcc3d21865191a4c9fc4";
  const oldTimestamp = 1785685134232;
  const mergedTimestamp = 1785688523544;
  const exists = sqlite.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'",
  ).get();
  if (exists === undefined) return;

  const recorded = sqlite.prepare<[number], { hash: string }>(
    "SELECT hash FROM __drizzle_migrations WHERE created_at = ?",
  ).all(oldTimestamp);
  if (recorded.length === 0) return;
  if (recorded.length !== 1 || recorded[0]?.hash !== hash) {
    throw new Error("Cannot reconcile attachment migration: the recorded SQL hash differs.");
  }

  // Never infer completion from a table name or skip SQL whose contents have changed.
  const migration = readMigrationFiles({ migrationsFolder }).find(
    (entry) => entry.folderMillis === mergedTimestamp,
  );
  if (migration?.hash !== hash) {
    throw new Error("Cannot reconcile attachment migration: the recorded SQL hash differs.");
  }
  sqlite.prepare(
    "UPDATE __drizzle_migrations SET created_at = ? WHERE hash = ? AND created_at = ?",
  ).run(mergedTimestamp, hash, oldTimestamp);
}
