import type { ProviderType } from "../../../shared/ipc";

interface ProviderDescriptor {
  readonly label: string;
  readonly description: string;
  readonly baseUrlRequired: boolean;
}

export const PROVIDER_CATALOG: Readonly<Record<ProviderType, ProviderDescriptor>> = {
  gateway: {
    label: "AI Gateway",
    description: "通过 AI SDK Gateway 访问多个模型供应商。",
    baseUrlRequired: false,
  },
  "openai-compatible": {
    label: "OpenAI Compatible",
    description: "连接实现 OpenAI 兼容接口的本地或远程服务。",
    baseUrlRequired: true,
  },
  openai: {
    label: "OpenAI",
    description: "OpenAI 官方 Provider。",
    baseUrlRequired: false,
  },
  anthropic: {
    label: "Anthropic",
    description: "Anthropic Claude 官方 Provider。",
    baseUrlRequired: false,
  },
  google: {
    label: "Google",
    description: "Google Generative AI 官方 Provider。",
    baseUrlRequired: false,
  },
  deepseek: {
    label: "DeepSeek",
    description: "DeepSeek 官方 Provider。",
    baseUrlRequired: false,
  },
  xai: {
    label: "xAI",
    description: "xAI Grok 官方 Provider。",
    baseUrlRequired: false,
  },
  moonshotai: {
    label: "Moonshot AI",
    description: "Moonshot AI 官方 Provider。",
    baseUrlRequired: false,
  },
  alibaba: {
    label: "Alibaba",
    description: "阿里云百炼模型服务官方 Provider。",
    baseUrlRequired: false,
  },
};
