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
