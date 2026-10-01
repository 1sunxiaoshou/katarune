import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import type { ModelMetadata, ModelSettings } from "../../shared/ipc";
import { MODEL_TYPES } from "../../shared/models";
import { PROVIDER_TYPES } from "../../shared/providers";
import { ASSET_KINDS } from "../../shared/assets";

export const assets = sqliteTable(
  "assets",
  {
    id: text("id").primaryKey(),
    kind: text("kind", { enum: ASSET_KINDS }).notNull(),
    storageKey: text("storage_key").notNull(),
    status: text("status", { enum: ["ready", "missing"] }).notNull(),
    mimeType: text("mime_type"),
    byteSize: integer("byte_size"),
    sha256: text("sha256"),
    originalName: text("original_name"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("assets_storage_key_unique").on(table.storageKey),
    check("assets_status_check", sql`${table.status} in ('ready', 'missing')`),
    check(
      "assets_kind_check",
      sql`${table.kind} in ('character_portrait', 'character_vrm', 'character_animation', 'chat_attachment')`,
    ),
    check(
      "assets_ready_metadata_check",
      sql`(${table.status} = 'ready' and ${table.mimeType} is not null and ${table.byteSize} is not null and ${table.sha256} is not null and ${table.originalName} is not null) or (${table.status} = 'missing' and ${table.mimeType} is null and ${table.byteSize} is null and ${table.sha256} is null and ${table.originalName} is null)`,
    ),
  ],
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
    modelType: text("model_type", { enum: MODEL_TYPES })
      .notNull()
      .default("languageModel"),
    modelId: text("model_id").notNull(),
    displayName: text("display_name"),
    metadata: text("metadata", { mode: "json" }).$type<ModelMetadata | null>(),
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

export const appSettings = sqliteTable(
  "app_settings",
  {
    id: integer("id").primaryKey(),
    defaultLanguageModelConfigId: text("default_language_model_config_id")
      .references(() => modelConfigs.id, { onDelete: "set null" }),
    defaultSpeechModelConfigId: text("default_speech_model_config_id")
      .references(() => modelConfigs.id, { onDelete: "set null" }),
    defaultAsrModel: text("default_asr_model").default("sensevoice-small-int8"),
    defaultSpeechVoice: text("default_speech_voice"),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [check("app_settings_singleton_check", sql`${table.id} = 1`)],
);

export const characterPackages = sqliteTable("character_packages", {
  id: text("id").primaryKey(),
  manifest: text("manifest", { mode: "json" }).$type<import("../../shared/characterPackages").CharacterPackageManifest>().notNull(),
  builtin: integer("builtin", { mode: "boolean" }).notNull().default(false),
  sourceHash: text("source_hash"),
  portraitAssetId: text("portrait_asset_id").references(() => assets.id, { onDelete: "restrict" }),
  thumbnailAssetId: text("thumbnail_asset_id").references(() => assets.id, { onDelete: "restrict" }),
}, table => [uniqueIndex("character_packages_source_hash_unique").on(table.sourceHash)]);

export const packageResources = sqliteTable("character_package_resources", {
  packageId: text("package_id").notNull().references(() => characterPackages.id, { onDelete: "cascade" }),
  path: text("path").notNull(),
  assetId: text("asset_id").notNull().references(() => assets.id, { onDelete: "restrict" }),
}, table => [primaryKey({ columns: [table.packageId, table.path] })]);

export const packageActions = sqliteTable("character_package_actions", {
  id: text("id").primaryKey(),
  packageId: text("package_id").notNull().references(() => characterPackages.id, { onDelete: "cascade" }),
  name: text("name").notNull(), description: text("description").notNull(), file: text("file").notNull(),
});

export const characters = sqliteTable(
  "characters",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    packageId: text("package_id").notNull().default("builtin:default").references(() => characterPackages.id, { onDelete: "restrict" }),
    portraitAssetId: text("portrait_asset_id").references(() => assets.id, {
      onDelete: "restrict",
    }),
    portraitFocusX: real("portrait_focus_x").notNull().default(0.5),
    portraitFocusY: real("portrait_focus_y").notNull().default(0),
    portraitZoom: real("portrait_zoom").notNull().default(1),
    modelConfigId: text("model_config_id"),
    speechModelConfigId: text("speech_model_config_id"),
    speechVoice: text("speech_voice"),
    useDefaultSpeechModel: integer("use_default_speech_model", { mode: "boolean" }).notNull().default(false),
    useDefaultSpeechVoice: integer("use_default_speech_voice", { mode: "boolean" }).notNull().default(false),
    systemPrompt: text("system_prompt").notNull().default(""),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("characters_created_at_idx").on(table.createdAt),
    check(
      "characters_portrait_focus_x_check",
      sql`${table.portraitFocusX} >= 0 and ${table.portraitFocusX} <= 1`,
    ),
    check(
      "characters_portrait_focus_y_check",
      sql`${table.portraitFocusY} >= 0 and ${table.portraitFocusY} <= 1`,
    ),
    check(
      "characters_portrait_zoom_check",
      sql`${table.portraitZoom} >= 1 and ${table.portraitZoom} <= 3`,
    ),
  ],
);

export const threads = sqliteTable(
  "threads",
  {
    id: text("id").primaryKey(),
    characterId: text("character_id")
      .notNull()
      .references(() => characters.id, { onDelete: "restrict" }),
    title: text("title").notNull(),
    status: text("status", { enum: ["regular", "archived"] })
      .notNull()
      .default("regular"),
    lastMessageAt: integer("last_message_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("threads_character_status_last_message_at_idx").on(
      table.characterId,
      table.status,
      table.lastMessageAt,
    ),
  ],
);

export const appState = sqliteTable(
  "app_state",
  {
    id: integer("id").primaryKey(),
    activeCharacterId: text("active_character_id")
      .notNull()
      .references(() => characters.id, { onDelete: "restrict" }),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [check("app_state_singleton_check", sql`${table.id} = 1`)],
);

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

export const messageAssets = sqliteTable(
  "message_assets",
  {
    messageId: text("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    assetId: text("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "restrict" }),
  },
  (table) => [
    primaryKey({ columns: [table.messageId, table.assetId] }),
    index("message_assets_asset_id_idx").on(table.assetId),
  ],
);
