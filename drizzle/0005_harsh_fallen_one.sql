CREATE TABLE `__new_provider_configs` (
	`id` text PRIMARY KEY NOT NULL,
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
INSERT INTO `__new_provider_configs` (
	`id`,
	`display_name`,
	`provider_type`,
	`base_url`,
	`credential_ref`,
	`settings`,
	`enabled`,
	`created_at`,
	`updated_at`
)
SELECT
	`id`,
	`display_name`,
	`provider_type`,
	`base_url`,
	`credential_ref`,
	`settings`,
	`enabled`,
	`created_at`,
	`updated_at`
FROM `provider_configs`;
--> statement-breakpoint
DROP TABLE `provider_configs`;
--> statement-breakpoint
ALTER TABLE `__new_provider_configs` RENAME TO `provider_configs`;
