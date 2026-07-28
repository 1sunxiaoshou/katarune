import { defineToolkit } from "@assistant-ui/react";
import {
  AISDKToolkit,
  type AISDKToolkitToolsOptions,
} from "@assistant-ui/react-ai-sdk";
import { anthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";
import { openai } from "@ai-sdk/openai";
import { xai } from "@ai-sdk/xai";
import type { ToolSet } from "ai";

export interface ProviderToolContext {
  readonly provider: string;
  readonly modelId: string;
}

export interface KataruneAiToolkitToolsOptions
  extends AISDKToolkitToolsOptions {
  readonly providerContext?: ProviderToolContext;
}

const kataruneToolkitDefinition = defineToolkit({
  get_current_time: {
    description:
      "Get the current date, time, and IANA time zone from the user's device.",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    execute: async () => ({
      iso: new Date().toISOString(),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    }),
  },
});

type WebProvider = "openai" | "anthropic" | "google" | "xai";

function resolveWebProvider({
  provider,
  modelId,
}: ProviderToolContext): WebProvider | undefined {
  if (provider === "gateway" || provider.startsWith("gateway.")) {
    const gatewayProvider = modelId.split("/", 1)[0];
    return gatewayProvider === "openai" ||
      gatewayProvider === "anthropic" ||
      gatewayProvider === "google" ||
      gatewayProvider === "xai"
      ? gatewayProvider
      : undefined;
  }

  const directProvider = provider.split(".", 1)[0];
  return directProvider === "openai" ||
    directProvider === "anthropic" ||
    directProvider === "google" ||
    directProvider === "xai"
    ? directProvider
    : undefined;
}

function providerTools(context: ProviderToolContext | undefined): ToolSet {
  if (context === undefined) return {};

  switch (resolveWebProvider(context)) {
    case "openai":
      return {
        web_search: openai.tools.webSearch(),
      };
    case "anthropic":
      return {
        web_search: anthropic.tools.webSearch_20250305({ maxUses: 5 }),
        web_fetch: anthropic.tools.webFetch_20250910({
          maxUses: 5,
          citations: { enabled: true },
        }),
      };
    case "google":
      return {
        google_search: google.tools.googleSearch({}),
        url_context: google.tools.urlContext({}),
      };
    case "xai":
      return {
        web_search: xai.tools.webSearch(),
      };
    case undefined:
      return {};
  }
}

class KataruneAiToolkit {
  readonly #toolkit = new AISDKToolkit({
    toolkit: kataruneToolkitDefinition,
  });

  async tools(options: KataruneAiToolkitToolsOptions = {}) {
    const { providerContext, ...aiSdkOptions } = options;
    const nativeProviderTools = providerTools(providerContext);
    const mainTools = await this.#toolkit.tools();
    const providerCollision = Object.keys(nativeProviderTools).find((name) =>
      Object.hasOwn(mainTools, name),
    );
    if (providerCollision !== undefined) {
      throw new Error(
        `Provider tool "${providerCollision}" conflicts with a trusted main tool.`,
      );
    }

    if (aiSdkOptions.frontend !== undefined) {
      const trustedTools = { ...mainTools, ...nativeProviderTools };
      const collision = Object.keys(aiSdkOptions.frontend).find((name) =>
        Object.hasOwn(trustedTools, name),
      );
      if (collision !== undefined) {
        throw new Error(
          `Frontend tool "${collision}" conflicts with a trusted tool.`,
        );
      }
    }

    return {
      ...(aiSdkOptions.frontend === undefined
        ? mainTools
        : await this.#toolkit.tools(aiSdkOptions)),
      ...nativeProviderTools,
    };
  }

  async close(): Promise<void> {
    await this.#toolkit.close();
  }
}

export const kataruneAiToolkit = new KataruneAiToolkit();
