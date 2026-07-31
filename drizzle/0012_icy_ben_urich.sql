ALTER TABLE `model_configs` RENAME COLUMN "speech_metadata" TO "metadata";
--> statement-breakpoint
UPDATE `model_configs`
SET `settings` = json_object(
  'defaultVoiceId',
  json_extract(`metadata`, '$.defaultVoiceId')
)
WHERE `model_type` = 'speechModel';
--> statement-breakpoint
UPDATE `model_configs`
SET `metadata` = json_object(
  'voices',
  json_extract(`metadata`, '$.voices')
)
WHERE `model_type` = 'speechModel' AND `metadata` IS NOT NULL;
