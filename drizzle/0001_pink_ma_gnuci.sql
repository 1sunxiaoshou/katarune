CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`parent_id` text,
	`format` text NOT NULL,
	`content` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `messages_thread_created_at_idx` ON `messages` (`thread_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `threads` ADD `status` text DEFAULT 'regular' NOT NULL;