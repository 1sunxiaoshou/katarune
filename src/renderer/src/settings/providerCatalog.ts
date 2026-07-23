import type { ProviderType } from "../../../shared/ipc";

interface ProviderDescriptor {
  readonly label: string;
  readonly baseUrlRequired: boolean;
  readonly baseUrlPlaceholder: string;
}

export const PROVIDER_CATALOG: Readonly<Record<ProviderType, ProviderDescriptor>> = {
  gateway: {
    label: "AI Gateway",
    baseUrlRequired: false,
    baseUrlPlaceholder: "https://ai-gateway.vercel.sh/v4/ai",
  },
  "openai-compatible": {
    label: "OpenAI Compatible",
    baseUrlRequired: true,
    baseUrlPlaceholder: "https://api.example.com/v1",
  },
  openai: {
    label: "OpenAI",
    baseUrlRequired: false,
    baseUrlPlaceholder: "https://api.openai.com/v1",
  },
  anthropic: {
    label: "Anthropic",
    baseUrlRequired: false,
    baseUrlPlaceholder: "https://api.anthropic.com/v1",
  },
  google: {
    label: "Google",
    baseUrlRequired: false,
    baseUrlPlaceholder: "https://generativelanguage.googleapis.com/v1beta",
  },
  deepseek: {
    label: "DeepSeek",
    baseUrlRequired: false,
    baseUrlPlaceholder: "https://api.deepseek.com",
  },
  xai: {
    label: "xAI",
    baseUrlRequired: false,
    baseUrlPlaceholder: "https://api.x.ai/v1",
  },
  moonshotai: {
    label: "Moonshot AI",
    baseUrlRequired: false,
    baseUrlPlaceholder: "https://api.moonshot.ai/v1",
  },
  alibaba: {
    label: "Alibaba",
    baseUrlRequired: false,
    baseUrlPlaceholder: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
  },
};
