import type { Character } from "../../../shared/ipc";
import {
  providerCredentialIsAvailable,
  providerSupportsModelType,
} from "../../../shared/providers";

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
  const [models, providers] = await Promise.all([
    window.katarune.listModelConfigs(),
    window.katarune.listProviderConfigs(),
  ]);
  const model = models.modelConfigs.find(
    (candidate) => candidate.id === character.speechModelConfigId,
  );
  if (
    model === undefined ||
    !model.enabled ||
    model.modelType !== "speechModel"
  ) {
    return false;
  }
  const provider = providers.providerConfigs.find(
    (candidate) => candidate.id === model.providerConfigId,
  );
  return (
    provider !== undefined &&
    provider.enabled &&
    providerCredentialIsAvailable(
      provider.providerType,
      provider.credentialRef,
    ) &&
    providerSupportsModelType(provider.providerType, "speechModel")
  );
}
