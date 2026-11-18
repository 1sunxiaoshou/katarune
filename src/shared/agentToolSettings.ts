import { z } from "zod";

export const agentToolScopeSchema = z.enum(["chat", "desktop", "live", "diary"]);
const toolIdSchema = z.string().min(1).max(250);
export const agentToolOverridesSchema = z.partialRecord(agentToolScopeSchema, z.record(toolIdSchema, z.boolean()));

export const agentToolScopeRequestSchema = z.strictObject({ scope: agentToolScopeSchema });
export const setAgentToolEnabledSchema = agentToolScopeRequestSchema.extend({ id: toolIdSchema, enabled: z.boolean() });
const agentToolSettingsRowSchema = z.strictObject({
  id: toolIdSchema,
  name: z.string().min(1),
  sourceId: z.string().min(1),
  sourceName: z.string().min(1),
  configurable: z.boolean(),
  enabled: z.boolean(),
  note: z.string().optional(),
});
export const agentToolSettingsListSchema = z.array(agentToolSettingsRowSchema);

export type AgentToolScope = z.infer<typeof agentToolScopeSchema>;
export type AgentToolScopeRequest = z.infer<typeof agentToolScopeRequestSchema>;
export type AgentToolOverrides = z.infer<typeof agentToolOverridesSchema>;
export type SetAgentToolEnabled = z.infer<typeof setAgentToolEnabledSchema>;
export type AgentToolSettingsRow = z.infer<typeof agentToolSettingsRowSchema>;

export function toolPolicyId(source: "system" | "native" | "provider" | "mcp", tool: string): string {
  return `${source}:${tool}`;
}

export function defaultAgentToolEnabled(scope: AgentToolScope, id: string): boolean {
  return id.startsWith("system:") && !(scope === "live" && id === "system:fetch_url");
}

export function agentToolEnabled(overrides: AgentToolOverrides | undefined, scope: AgentToolScope, id: string): boolean {
  return overrides?.[scope]?.[id] ?? defaultAgentToolEnabled(scope, id);
}

export const AGENT_TOOL_SETTINGS_CHANNELS = {
  list: "agent-tool-settings:list",
  setEnabled: "agent-tool-settings:set-enabled",
} as const;

export interface AgentToolSettingsApi {
  listAgentToolSettings(request: AgentToolScopeRequest): Promise<AgentToolSettingsRow[]>;
  setAgentToolEnabled(request: SetAgentToolEnabled): Promise<AgentToolSettingsRow[]>;
}
