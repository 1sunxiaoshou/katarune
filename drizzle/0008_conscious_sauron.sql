DROP INDEX `threads_character_status_updated_at_idx`;--> statement-breakpoint
ALTER TABLE `threads` ADD `last_message_at` integer;--> statement-breakpoint
UPDATE `threads`
SET `last_message_at` = COALESCE(
  (SELECT MAX(`messages`.`created_at`) FROM `messages` WHERE `messages`.`thread_id` = `threads`.`id`),
  `threads`.`created_at`
);--> statement-breakpoint
CREATE INDEX `threads_character_status_last_message_at_idx` ON `threads` (`character_id`,`status`,`last_message_at`);
