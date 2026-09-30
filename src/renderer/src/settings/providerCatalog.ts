import type { ProviderType } from "../../../shared/ipc";

interface ProviderDescriptor {
  readonly label: string;
  readonly description: string;
  readonly baseUrlRequired: boolean;
  readonly baseUrlPlaceholder: string;
}

export const PROVIDER_CATALOG: Readonly<Record<ProviderType, ProviderDescriptor>> = {
  gateway: {
    label: "AI Gateway",
    description: "一个凭据访问多家模型，适合快速开始。",
    baseUrlRequired: false,
    baseUrlPlaceholder: "https://ai-gateway.vercel.sh/v4/ai",
  },
  "openai-compatible": {
    label: "OpenAI Compatible",
    description: "连接 Ollama、OpenRouter 或自托管服务。",
    baseUrlRequired: true,
    baseUrlPlaceholder: "https://api.example.com/v1",
  },
  openai: {
    label: "OpenAI",
    description: "GPT、图像与语音模型的官方接口。",
    baseUrlRequired: false,
    baseUrlPlaceholder: "https://api.openai.com/v1",
  },
  anthropic: {
    label: "Anthropic",
    description: "Claude 系列模型的官方接口。",
    baseUrlRequired: false,
    baseUrlPlaceholder: "https://api.anthropic.com/v1",
  },
  google: {
    label: "Google",
    description: "Gemini 语言、视觉与语音模型。",
    baseUrlRequired: false,
    baseUrlPlaceholder: "https://generativelanguage.googleapis.com/v1beta",
  },
  "fish-audio": {
    label: "Fish Audio",
    description: "角色音色与高质量语音生成。",
    baseUrlRequired: false,
    baseUrlPlaceholder: "https://api.fish.audio",
  },
  deepseek: {
    label: "DeepSeek",
    description: "DeepSeek Chat 与推理模型。",
    baseUrlRequired: false,
    baseUrlPlaceholder: "https://api.deepseek.com",
  },
  xai: {
    label: "xAI",
    description: "Grok 系列模型的官方接口。",
    baseUrlRequired: false,
    baseUrlPlaceholder: "https://api.x.ai/v1",
  },
  moonshotai: {
    label: "Moonshot AI",
    description: "Kimi 系列模型的官方接口。",
    baseUrlRequired: false,
    baseUrlPlaceholder: "https://api.moonshot.ai/v1",
  },
  alibaba: {
    label: "Alibaba",
    description: "通义千问系列模型兼容接口。",
    baseUrlRequired: false,
    baseUrlPlaceholder: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
  },
};
