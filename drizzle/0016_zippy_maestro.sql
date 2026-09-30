ALTER TABLE `app_settings` ADD `default_speech_voice` text;--> statement-breakpoint
ALTER TABLE `characters` ADD `use_default_speech_voice` integer DEFAULT false NOT NULL;