PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_characters` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`portrait_asset_id` text,
	`portrait_focus_x` real DEFAULT 0.5 NOT NULL,
	`portrait_focus_y` real DEFAULT 0 NOT NULL,
	`portrait_zoom` real DEFAULT 1 NOT NULL,
	`model_config_id` text,
	`speech_model_config_id` text,
	`speech_voice` text,
	`system_prompt` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`portrait_asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "characters_portrait_focus_x_check" CHECK("__new_characters"."portrait_focus_x" >= 0 and "__new_characters"."portrait_focus_x" <= 1),
	CONSTRAINT "characters_portrait_focus_y_check" CHECK("__new_characters"."portrait_focus_y" >= 0 and "__new_characters"."portrait_focus_y" <= 1),
	CONSTRAINT "characters_portrait_zoom_check" CHECK("__new_characters"."portrait_zoom" >= 1 and "__new_characters"."portrait_zoom" <= 3)
);
--> statement-breakpoint
INSERT INTO `__new_characters`("id", "name", "portrait_asset_id", "portrait_focus_x", "portrait_focus_y", "portrait_zoom", "model_config_id", "speech_model_config_id", "speech_voice", "system_prompt", "created_at", "updated_at") SELECT "id", "name", "portrait_asset_id", 0.5, 0, 1, "model_config_id", "speech_model_config_id", "speech_voice", "system_prompt", "created_at", "updated_at" FROM `characters`;--> statement-breakpoint
DROP TABLE `characters`;--> statement-breakpoint
ALTER TABLE `__new_characters` RENAME TO `characters`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `characters_created_at_idx` ON `characters` (`created_at`);
