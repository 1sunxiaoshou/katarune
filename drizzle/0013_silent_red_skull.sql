CREATE TABLE `app_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`default_language_model_config_id` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`default_language_model_config_id`) REFERENCES `model_configs`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "app_settings_singleton_check" CHECK("app_settings"."id" = 1)
);
