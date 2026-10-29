CREATE TABLE `live_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`config` text NOT NULL,
	`credential_ref` text
);
--> statement-breakpoint
ALTER TABLE `threads` ADD `kind` text DEFAULT 'chat' NOT NULL;