CREATE TABLE `character_packages` (
	`id` text PRIMARY KEY NOT NULL,
	`manifest` text NOT NULL,
	`builtin` integer DEFAULT false NOT NULL,
	`source_hash` text,
	`portrait_asset_id` text,
	`thumbnail_asset_id` text,
	FOREIGN KEY (`portrait_asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`thumbnail_asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `character_packages_source_hash_unique` ON `character_packages` (`source_hash`);--> statement-breakpoint
CREATE TABLE `character_package_actions` (
	`id` text PRIMARY KEY NOT NULL,
	`package_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`file` text NOT NULL,
	FOREIGN KEY (`package_id`) REFERENCES `character_packages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `character_package_resources` (
	`package_id` text NOT NULL,
	`path` text NOT NULL,
	`asset_id` text NOT NULL,
	PRIMARY KEY(`package_id`, `path`),
	FOREIGN KEY (`package_id`) REFERENCES `character_packages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`storage_key` text NOT NULL,
	`status` text NOT NULL,
	`mime_type` text,
	`byte_size` integer,
	`sha256` text,
	`original_name` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "assets_status_check" CHECK("__new_assets"."status" in ('ready', 'missing')),
	CONSTRAINT "assets_kind_check" CHECK("__new_assets"."kind" in ('character_portrait', 'character_vrm', 'character_animation', 'chat_attachment')),
	CONSTRAINT "assets_ready_metadata_check" CHECK(("__new_assets"."status" = 'ready' and "__new_assets"."mime_type" is not null and "__new_assets"."byte_size" is not null and "__new_assets"."sha256" is not null and "__new_assets"."original_name" is not null) or ("__new_assets"."status" = 'missing' and "__new_assets"."mime_type" is null and "__new_assets"."byte_size" is null and "__new_assets"."sha256" is null and "__new_assets"."original_name" is null))
);
--> statement-breakpoint
INSERT INTO `__new_assets`("id", "kind", "storage_key", "status", "mime_type", "byte_size", "sha256", "original_name", "created_at", "updated_at") SELECT "id", "kind", "storage_key", "status", "mime_type", "byte_size", "sha256", "original_name", "created_at", "updated_at" FROM `assets`;--> statement-breakpoint
DROP TABLE `assets`;--> statement-breakpoint
ALTER TABLE `__new_assets` RENAME TO `assets`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `assets_storage_key_unique` ON `assets` (`storage_key`);--> statement-breakpoint
INSERT INTO `character_packages` (`id`, `manifest`, `builtin`) VALUES ('builtin:default', '{}', 1);
--> statement-breakpoint
ALTER TABLE `characters` ADD `package_id` text DEFAULT 'builtin:default' NOT NULL REFERENCES character_packages(id);