DROP TABLE `memory_links`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_memory_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`character_id` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`day` text,
	`is_user` integer DEFAULT false NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`updated_at` integer NOT NULL,
	`forgotten_at` integer,
	FOREIGN KEY (`character_id`) REFERENCES `characters`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "memory_entry_kind_check" CHECK(("__new_memory_entries"."kind" = 'diary' and "__new_memory_entries"."day" is not null and "__new_memory_entries"."is_user" = 0) or ("__new_memory_entries"."kind" = 'person' and "__new_memory_entries"."day" is null) or ("__new_memory_entries"."kind" = 'event' and "__new_memory_entries"."day" is null and "__new_memory_entries"."is_user" = 0)),
	CONSTRAINT "memory_revision_positive" CHECK("__new_memory_entries"."revision" > 0)
);
--> statement-breakpoint
-- Keep long bodies intact; add the retired progress label only when it fits the text limit.
INSERT INTO `__new_memory_entries`("id", "character_id", "kind", "title", "body", "day", "is_user", "revision", "updated_at", "forgotten_at") SELECT "id", "character_id", "kind", "title", CASE WHEN "kind" = 'event' AND length(CAST("body" AS BLOB)) <= 31990 THEN '进展：' || CASE "status" WHEN 'active' THEN '进行中' WHEN 'completed' THEN '已完成' WHEN 'paused' THEN '已暂停' WHEN 'cancelled' THEN '已取消' END || char(10) || char(10) || "body" ELSE "body" END, "day", "is_user", "revision", "updated_at", "forgotten_at" FROM `memory_entries`;--> statement-breakpoint
DROP TABLE `memory_entries`;--> statement-breakpoint
ALTER TABLE `__new_memory_entries` RENAME TO `memory_entries`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `memory_diary_day_unique` ON `memory_entries` (`character_id`,`day`);--> statement-breakpoint
CREATE UNIQUE INDEX `memory_user_profile_unique` ON `memory_entries` (`character_id`) WHERE "memory_entries"."is_user" = 1 and "memory_entries"."forgotten_at" is null;--> statement-breakpoint
CREATE INDEX `memory_entries_character_kind_updated_idx` ON `memory_entries` (`character_id`,`kind`,`updated_at`);