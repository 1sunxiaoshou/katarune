import { readFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
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

  if (config.character.portrait !== null) {
    const root = resolve(characterResourcesPath);
    const file = config.character.portrait.file;
    const remainder = relative(root, resolve(root, file));
    if (!remainder || remainder.startsWith("..") || isAbsolute(remainder)) {
      throw new Error("The default character portrait must be a file in the character resource folder.");
    }
  }

  return config;
}
