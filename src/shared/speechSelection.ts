import { parseSpeechModelSettings, type AppSettings, type Character, type ModelConfig } from "./ipc";

/** The stored speech model also identifies the model for which the voice was selected. */
export function resolveCharacterSpeechModel(
  character: Character,
  settings: AppSettings,
): string | null {
  const modelId = character.useDefaultSpeechModel
    ? settings.defaultSpeechModelConfigId
    : character.speechModelConfigId;
  return modelId;
}

export function defaultVoiceForModel(model: ModelConfig | undefined, settings: AppSettings): string | null {
  if (!model || model.modelType !== "speechModel") return null;
  return model.id === settings.defaultSpeechModelConfigId
    ? settings.defaultSpeechVoice
    : parseSpeechModelSettings(model.settings)?.defaultVoiceId ?? null;
}

export function resolveCharacterSpeechVoice(character: Character, settings: AppSettings, model: ModelConfig): string | null {
  if (character.useDefaultSpeechVoice) return defaultVoiceForModel(model, settings);
  return character.speechModelConfigId === model.id ? character.speechVoice : null;
}
