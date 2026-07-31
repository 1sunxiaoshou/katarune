export const PROVIDER_TYPES = [
  "gateway",
  "openai-compatible",
  "openai",
  "anthropic",
  "google",
  "fish-audio",
  "deepseek",
  "xai",
  "moonshotai",
  "alibaba",
] as const;

export type ProviderType = (typeof PROVIDER_TYPES)[number];

export type CredentialMode = "required" | "optional";

export interface ProviderCredentialRequirement {
  readonly credentialMode: CredentialMode;
}

export const PROVIDER_CREDENTIAL_REQUIREMENTS = {
  gateway: { credentialMode: "required" },
  "openai-compatible": { credentialMode: "optional" },
  openai: { credentialMode: "required" },
  anthropic: { credentialMode: "required" },
  google: { credentialMode: "required" },
  "fish-audio": { credentialMode: "required" },
  deepseek: { credentialMode: "required" },
  xai: { credentialMode: "required" },
  moonshotai: { credentialMode: "required" },
  alibaba: { credentialMode: "required" },
} as const satisfies Readonly<
  Record<ProviderType, ProviderCredentialRequirement>
>;

export function getProviderCredentialRequirement(
  providerType: ProviderType,
): ProviderCredentialRequirement {
  return PROVIDER_CREDENTIAL_REQUIREMENTS[providerType];
}

export function providerCredentialIsAvailable(
  providerType: ProviderType,
  credentialRef: string | null,
): boolean {
  return (
    getProviderCredentialRequirement(providerType).credentialMode ===
      "optional" || credentialRef !== null
  );
}
