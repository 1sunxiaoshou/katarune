ALTER TABLE `app_settings` ADD `default_speech_model_config_id` text REFERENCES model_configs(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `app_settings` ADD `default_asr_model` text DEFAULT 'sensevoice-small-int8';--> statement-breakpoint
ALTER TABLE `characters` ADD `use_default_speech_model` integer DEFAULT false NOT NULL;