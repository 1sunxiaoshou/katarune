import type { AppSettings, Character } from "../../../shared/ipc";

import { resolveCharacterSpeechModel, resolveCharacterSpeechVoice } from "../../../shared/speechSelection";

export const SPEECH_CONFIG_CHANGED_EVENT =
  "katarune:speech-config-changed";

export async function isCharacterSpeechAvailable(
  character: Character,
  settings: AppSettings,
): Promise<boolean> {
  const modelId = resolveCharacterSpeechModel(character, settings);
  if (modelId === null) return false;
  const { modelConfigIds } = await window.katarune.listAvailableModels();
  if (!modelConfigIds.includes(modelId)) return false;
  const model = await window.katarune.fetchModelConfig({ id: modelId });
  return resolveCharacterSpeechVoice(character, settings, model) !== null;
}
