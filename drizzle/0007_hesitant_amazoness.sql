CREATE TABLE `assets` (
	`id` text PRIMARY KEY NOT NULL,
	`storage_key` text NOT NULL,
	`status` text NOT NULL,
	`mime_type` text,
	`byte_size` integer,
	`sha256` text,
	`original_name` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "assets_status_check" CHECK("status" in ('ready', 'missing')),
	CONSTRAINT "assets_ready_metadata_check" CHECK(("status" = 'ready' and "mime_type" is not null and "byte_size" is not null and "sha256" is not null and "original_name" is not null) or ("status" = 'missing' and "mime_type" is null and "byte_size" is null and "sha256" is null and "original_name" is null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `assets_storage_key_unique` ON `assets` (`storage_key`);
--> statement-breakpoint
INSERT OR IGNORE INTO `assets` (`id`, `storage_key`, `status`, `mime_type`, `byte_size`, `sha256`, `original_name`, `created_at`, `updated_at`)
SELECT DISTINCT `portrait_asset_id`, `portrait_asset_id`, 'missing', NULL, NULL, NULL, NULL, `created_at`, `updated_at`
FROM `characters`
WHERE `portrait_asset_id` IS NOT NULL;
--> statement-breakpoint
INSERT OR IGNORE INTO `assets` (`id`, `storage_key`, `status`, `mime_type`, `byte_size`, `sha256`, `original_name`, `created_at`, `updated_at`)
SELECT '00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000002', 'missing', NULL, NULL, NULL, NULL, 1784864546069, 1784864546069
WHERE EXISTS (SELECT 1 FROM `threads`) AND NOT EXISTS (SELECT 1 FROM `characters`);
--> statement-breakpoint
INSERT OR IGNORE INTO `characters` (`id`, `name`, `portrait_asset_id`, `model_config_id`, `system_prompt`, `created_at`, `updated_at`)
SELECT
	'00000000-0000-4000-8000-000000000001',
	'星澜',
	'00000000-0000-4000-8000-000000000002',
	NULL,
	'你是星澜，一位温柔、沉静且富有好奇心的数字角色。你会用自然、简洁的中文与用户交流，认真倾听，不夸大自己的能力，也不会编造不确定的信息。',
	1784864546069,
	1784864546069
WHERE EXISTS (SELECT 1 FROM `threads`) AND NOT EXISTS (SELECT 1 FROM `characters`);
--> statement-breakpoint
CREATE TABLE `__new_characters` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`portrait_asset_id` text,
	`model_config_id` text,
	`system_prompt` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`portrait_asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
INSERT INTO `__new_characters` SELECT * FROM `characters`;
--> statement-breakpoint
DROP TABLE `characters`;
--> statement-breakpoint
ALTER TABLE `__new_characters` RENAME TO `characters`;
--> statement-breakpoint
CREATE INDEX `characters_created_at_idx` ON `characters` (`created_at`);
--> statement-breakpoint
CREATE TABLE `__new_threads` (
	`id` text PRIMARY KEY NOT NULL,
	`character_id` text NOT NULL,
	`title` text NOT NULL,
	`status` text DEFAULT 'regular' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`character_id`) REFERENCES `characters`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
INSERT INTO `__new_threads` (`id`, `character_id`, `title`, `status`, `created_at`, `updated_at`)
SELECT
	`id`,
	COALESCE(
		(SELECT `id` FROM `characters` WHERE `id` = '00000000-0000-4000-8000-000000000001'),
		(SELECT `id` FROM `characters` ORDER BY `created_at`, `id` LIMIT 1)
	),
	`title`,
	`status`,
	`created_at`,
	`updated_at`
FROM `threads`;
--> statement-breakpoint
DROP TABLE `threads`;
--> statement-breakpoint
ALTER TABLE `__new_threads` RENAME TO `threads`;
--> statement-breakpoint
CREATE INDEX `threads_character_status_updated_at_idx` ON `threads` (`character_id`,`status`,`updated_at`);
--> statement-breakpoint
CREATE TABLE `app_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`active_character_id` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`active_character_id`) REFERENCES `characters`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "app_state_singleton_check" CHECK("id" = 1)
);
--> statement-breakpoint
INSERT INTO `app_state` (`id`, `active_character_id`, `updated_at`)
SELECT
	1,
	COALESCE(
		(SELECT `id` FROM `characters` WHERE `id` = '00000000-0000-4000-8000-000000000001'),
		(SELECT `id` FROM `characters` ORDER BY `created_at`, `id` LIMIT 1)
	),
	1784864546069
WHERE EXISTS (SELECT 1 FROM `characters`);
