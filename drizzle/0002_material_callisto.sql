CREATE TABLE `provider_configs` (
	`id` text PRIMARY KEY NOT NULL,
	`registry_id` text NOT NULL,
	`display_name` text NOT NULL,
	`provider_type` text NOT NULL,
	`base_url` text,
	`credential_ref` text,
	`settings` text,
	`enabled` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `provider_configs_registry_id_unique` ON `provider_configs` (`registry_id`);