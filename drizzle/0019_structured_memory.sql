CREATE TABLE `memory_diary_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`character_id` text NOT NULL,
	`day` text NOT NULL,
	`time_zone` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`retry_at` integer NOT NULL,
	FOREIGN KEY (`character_id`) REFERENCES `characters`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `memory_diary_job_day_unique` ON `memory_diary_jobs` (`character_id`,`day`);--> statement-breakpoint
CREATE TABLE `memory_diary_messages` (
	`job_id` text NOT NULL,
	`message_id` text NOT NULL,
	PRIMARY KEY(`job_id`, `message_id`),
	FOREIGN KEY (`job_id`) REFERENCES `memory_diary_jobs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `memory_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`character_id` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`day` text,
	`is_user` integer DEFAULT false NOT NULL,
	`status` text,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`forgotten_at` integer,
	FOREIGN KEY (`character_id`) REFERENCES `characters`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "memory_entry_kind_check" CHECK(("memory_entries"."kind" = 'diary' and "memory_entries"."day" is not null and "memory_entries"."status" is null and "memory_entries"."is_user" = 0) or ("memory_entries"."kind" = 'person' and "memory_entries"."day" is null and "memory_entries"."status" is null) or ("memory_entries"."kind" = 'event' and "memory_entries"."day" is null and "memory_entries"."status" in ('active', 'completed', 'paused', 'cancelled') and "memory_entries"."is_user" = 0)),
	CONSTRAINT "memory_revision_positive" CHECK("memory_entries"."revision" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `memory_entries_character_id_unique` ON `memory_entries` (`character_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `memory_diary_day_unique` ON `memory_entries` (`character_id`,`day`);--> statement-breakpoint
CREATE UNIQUE INDEX `memory_user_profile_unique` ON `memory_entries` (`character_id`) WHERE "memory_entries"."is_user" = 1 and "memory_entries"."forgotten_at" is null;--> statement-breakpoint
CREATE INDEX `memory_entries_character_kind_updated_idx` ON `memory_entries` (`character_id`,`kind`,`updated_at`);--> statement-breakpoint
CREATE TABLE `memory_links` (
	`character_id` text NOT NULL,
	`from_id` text NOT NULL,
	`to_id` text NOT NULL,
	PRIMARY KEY(`from_id`, `to_id`),
	FOREIGN KEY (`character_id`,`from_id`) REFERENCES `memory_entries`(`character_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`character_id`,`to_id`) REFERENCES `memory_entries`(`character_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "memory_link_order" CHECK("memory_links"."from_id" < "memory_links"."to_id")
);
--> statement-breakpoint
CREATE INDEX `memory_links_to_idx` ON `memory_links` (`to_id`);--> statement-breakpoint
CREATE TABLE `memory_preferences` (
	`character_id` text PRIMARY KEY NOT NULL,
	`diary_enabled` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`character_id`) REFERENCES `characters`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `memory_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`entry_id` text NOT NULL,
	`thread_id` text,
	`message_id` text,
	`label` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`entry_id`) REFERENCES `memory_entries`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `memory_sources_entry_idx` ON `memory_sources` (`entry_id`);