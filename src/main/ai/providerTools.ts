import type { ToolSet } from "ai";
import type { ProviderConfig, ProviderToolDescriptor } from "../../shared/ipc";
import type { AgentToolScope } from "../../shared/agentToolSettings";
import type { ChatAttachmentBytes } from "../assets/assetService";

export interface ProviderToolContext {
  readonly readCurrentAttachment?: (attachmentId: string) => ChatAttachmentBytes;
  readonly writeSpeechFile?: (audio: Uint8Array, abortSignal: AbortSignal | undefined) => Promise<string>;
}

export interface ProviderToolDefinition extends ProviderToolDescriptor {
  readonly supportsLive?: true;
  readonly acceptsAttachment?: (filename: string) => boolean;
  createTool(apiKey: string, context: ProviderToolContext): ToolSet[string] | undefined;
}

export type ProviderToolScope = Exclude<AgentToolScope, "diary">;

export function providerToolSupportsScope(tool: ProviderToolDefinition, scope: ProviderToolScope): boolean {
  return scope !== "live" || tool.supportsLive === true;
}

export interface ProviderToolCatalog {
  supports(config: ProviderConfig): boolean;
  readonly tools: readonly ProviderToolDefinition[];
}

export interface ProviderChatTools {
  readonly tools: ToolSet;
  attachmentTool(filename: string): string | undefined;
}
