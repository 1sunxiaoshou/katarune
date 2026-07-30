import type { Character } from "../../../shared/ipc";

export const SPEECH_CONFIG_CHANGED_EVENT =
  "katarune:speech-config-changed";

export async function isCharacterSpeechAvailable(
  character: Character,
): Promise<boolean> {
  if (
    character.speechModelConfigId === null ||
    character.speechVoice === null
  ) {
    return false;
  }
  const { modelConfigIds } = await window.katarune.listAvailableSpeechModels();
  return modelConfigIds.includes(character.speechModelConfigId);
}
