import { createAlibaba } from "@ai-sdk/alibaba";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { createGoogle } from "@ai-sdk/google";
import { createMoonshotAI } from "@ai-sdk/moonshotai";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createXai } from "@ai-sdk/xai";
import { createGateway, createProviderRegistry } from "ai";
import type { ProviderConfig } from "../../shared/ipc";

export type RegistryProvider = Parameters<typeof createProviderRegistry>[0][string];

function optionalFactorySettings(
  config: ProviderConfig,
  apiKey: string | undefined,
): { apiKey?: string; baseURL?: string } {
  return {
    ...(apiKey === undefined ? {} : { apiKey }),
    ...(config.baseUrl === null ? {} : { baseURL: config.baseUrl }),
  };
}

export function createConfiguredProvider(
  config: ProviderConfig,
  apiKey: string | undefined,
): RegistryProvider {
  const settings = optionalFactorySettings(config, apiKey);

  switch (config.providerType) {
    case "gateway":
      return createGateway(settings);
    case "openai-compatible": {
      if (config.baseUrl === null) {
        throw new Error("An OpenAI-compatible Provider requires a base URL.");
      }
      return createOpenAICompatible({
        name: config.id,
        baseURL: config.baseUrl,
        ...(apiKey === undefined ? {} : { apiKey }),
        ...(config.settings?.includeUsage === undefined
          ? {}
          : { includeUsage: config.settings.includeUsage }),
        ...(config.settings?.supportsStructuredOutputs === undefined
          ? {}
          : { supportsStructuredOutputs: config.settings.supportsStructuredOutputs }),
      });
    }
    case "openai":
      return createOpenAI(settings);
    case "anthropic":
      return createAnthropic(settings);
    case "google":
      return createGoogle(settings);
    case "deepseek":
      return createDeepSeek(settings);
    case "xai":
      return createXai(settings);
    case "moonshotai":
      return createMoonshotAI(settings);
    case "alibaba":
      return createAlibaba({
        ...settings,
        ...(config.settings?.includeUsage === undefined
          ? {}
          : { includeUsage: config.settings.includeUsage }),
      });
  }
}
