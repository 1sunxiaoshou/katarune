import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import type { ModelSettings } from "../../shared/ipc";
import { PROVIDER_TYPES } from "../../shared/providers";

export const threads = sqliteTable("threads", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  status: text("status", { enum: ["regular", "archived"] })
    .notNull()
    .default("regular"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const messages = sqliteTable(
  "messages",
  {
    id: text("id").primaryKey(),
    threadId: text("thread_id")
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    parentId: text("parent_id"),
    format: text("format").notNull(),
    content: text("content", { mode: "json" })
      .$type<Record<string, unknown>>()
      .notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("messages_thread_created_at_idx").on(table.threadId, table.createdAt)],
);

export const providerConfigs = sqliteTable("provider_configs", {
  id: text("id").primaryKey(),
  displayName: text("display_name").notNull(),
  providerType: text("provider_type", { enum: PROVIDER_TYPES }).notNull(),
  baseUrl: text("base_url"),
  credentialRef: text("credential_ref"),
  settings: text("settings", { mode: "json" }).$type<Record<string, unknown> | null>(),
  enabled: integer("enabled", { mode: "boolean" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const modelConfigs = sqliteTable(
  "model_configs",
  {
    id: text("id").primaryKey(),
    providerConfigId: text("provider_config_id")
      .notNull()
      .references(() => providerConfigs.id, { onDelete: "cascade" }),
    modelId: text("model_id").notNull(),
    displayName: text("display_name"),
    settings: text("settings", { mode: "json" }).$type<ModelSettings | null>(),
    enabled: integer("enabled", { mode: "boolean" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("model_configs_provider_model_unique").on(
      table.providerConfigId,
      table.modelId,
    ),
  ],
);
