CREATE TABLE `thread_directory_grants` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`path` text NOT NULL,
	`access` text NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "thread_directory_grants_access_check" CHECK("thread_directory_grants"."access" in ('read', 'read-write'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `thread_directory_grants_path_unique` ON `thread_directory_grants` (`thread_id`,`path`);--> statement-breakpoint
CREATE TABLE `thread_tool_access` (
	`thread_id` text PRIMARY KEY NOT NULL,
	`mode` text DEFAULT 'request-approval' NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "thread_tool_access_mode_check" CHECK("thread_tool_access"."mode" in ('request-approval', 'full-access'))
);
--> statement-breakpoint
DROP TABLE `character_directory_grants`;--> statement-breakpoint
DROP TABLE `character_tool_access`;