import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import {
  defaultCharacterConfigSchema,
  type DefaultCharacterConfig,
} from "../../shared/characters";

export function loadDefaultCharacterConfig(
  characterResourcesPath: string,
): DefaultCharacterConfig {
  const configPath = join(characterResourcesPath, "default-character.json");
  const parsed: unknown = JSON.parse(readFileSync(configPath, "utf8"));
  const config = defaultCharacterConfigSchema.parse(parsed);

  if (
    config.character.portrait !== null &&
    basename(config.character.portrait.file) !== config.character.portrait.file
  ) {
    throw new Error("The default character portrait must be a file in the character resource folder.");
  }

  return config;
}
