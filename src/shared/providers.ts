import type { ModelType } from "./models";

export const PROVIDER_TYPES = [
  "gateway",
  "openai-compatible",
  "openai",
  "anthropic",
  "google",
  "deepseek",
  "xai",
  "moonshotai",
  "alibaba",
] as const;

export type ProviderType = (typeof PROVIDER_TYPES)[number];

export type CredentialMode = "required" | "optional";

export interface SpeechOutputMetadata {
  readonly format: string;
  readonly mediaType: `audio/${string}`;
}

export interface SpeechCapabilityMetadata {
  readonly defaultVoice: string | null;
  readonly preferredOutput: SpeechOutputMetadata;
}

export interface ProviderCapabilityMetadata {
  readonly credentialMode: CredentialMode;
  readonly supportedModelTypes: readonly ModelType[];
  readonly speech?: SpeechCapabilityMetadata;
}

const LANGUAGE_MODEL_ONLY = ["languageModel"] as const satisfies readonly ModelType[];

export const PROVIDER_CAPABILITIES = {
  gateway: {
    credentialMode: "required",
    supportedModelTypes: LANGUAGE_MODEL_ONLY,
  },
  "openai-compatible": {
    credentialMode: "optional",
    supportedModelTypes: LANGUAGE_MODEL_ONLY,
  },
  openai: {
    credentialMode: "required",
    supportedModelTypes: ["languageModel", "speechModel"],
    speech: {
      defaultVoice: "alloy",
      preferredOutput: {
        format: "wav",
        mediaType: "audio/wav",
      },
    },
  },
  anthropic: {
    credentialMode: "required",
    supportedModelTypes: LANGUAGE_MODEL_ONLY,
  },
  google: {
    credentialMode: "required",
    supportedModelTypes: LANGUAGE_MODEL_ONLY,
  },
  deepseek: {
    credentialMode: "required",
    supportedModelTypes: LANGUAGE_MODEL_ONLY,
  },
  xai: {
    credentialMode: "required",
    supportedModelTypes: LANGUAGE_MODEL_ONLY,
  },
  moonshotai: {
    credentialMode: "required",
    supportedModelTypes: LANGUAGE_MODEL_ONLY,
  },
  alibaba: {
    credentialMode: "required",
    supportedModelTypes: LANGUAGE_MODEL_ONLY,
  },
} as const satisfies Readonly<Record<ProviderType, ProviderCapabilityMetadata>>;

export function getProviderCapabilities(
  providerType: ProviderType,
): ProviderCapabilityMetadata {
  return PROVIDER_CAPABILITIES[providerType];
}

export function providerSupportsModelType(
  providerType: ProviderType,
  modelType: ModelType,
): boolean {
  return getProviderCapabilities(providerType).supportedModelTypes.includes(modelType);
}

export function providerCredentialIsAvailable(
  providerType: ProviderType,
  credentialRef: string | null,
): boolean {
  return (
    getProviderCapabilities(providerType).credentialMode === "optional" ||
    credentialRef !== null
  );
}
