CREATE TABLE `model_configs` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_config_id` text NOT NULL,
	`model_id` text NOT NULL,
	`display_name` text,
	`settings` text,
	`enabled` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`provider_config_id`) REFERENCES `provider_configs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `model_configs_provider_model_unique` ON `model_configs` (`provider_config_id`,`model_id`);