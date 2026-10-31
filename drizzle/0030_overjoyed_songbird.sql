CREATE TABLE `character_directory_grants` (
	`id` text PRIMARY KEY NOT NULL,
	`character_id` text NOT NULL,
	`path` text NOT NULL,
	`access` text NOT NULL,
	FOREIGN KEY (`character_id`) REFERENCES `characters`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "character_directory_grants_access_check" CHECK("character_directory_grants"."access" in ('read', 'read-write'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `character_directory_grants_path_unique` ON `character_directory_grants` (`character_id`,`path`);--> statement-breakpoint
CREATE TABLE `character_tool_access` (
	`character_id` text PRIMARY KEY NOT NULL,
	`mode` text DEFAULT 'request-approval' NOT NULL,
	FOREIGN KEY (`character_id`) REFERENCES `characters`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "character_tool_access_mode_check" CHECK("character_tool_access"."mode" in ('request-approval', 'full-access'))
);
