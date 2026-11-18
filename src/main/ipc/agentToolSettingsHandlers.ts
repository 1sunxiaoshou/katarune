import {
  AGENT_TOOL_SETTINGS_CHANNELS,
  agentToolScopeRequestSchema,
  agentToolSettingsListSchema,
  setAgentToolEnabledSchema,
  type AgentToolScope,
} from "../../shared/agentToolSettings";
import { listAgentToolSettings } from "../ai/agentToolPolicy";
import type { AiRuntime } from "../ai/runtime";
import type { DatabaseRuntime } from "../database/database";
import { diagnosticIpcMain } from "../diagnostics/ipc";
import { OperationRejected, parseRequest } from "../diagnostics/operationRejected";
import type { McpService } from "../mcp/mcpService";

export function registerAgentToolSettingsHandlers(
  database: Pick<DatabaseRuntime, "getAgentToolOverrides" | "listProviderConfigs" | "setAgentToolEnabled">,
  aiRuntime: Pick<AiRuntime, "listProviderTools">,
  mcp?: Pick<McpService, "list">,
): void {
  const list = (scope: AgentToolScope) =>
    agentToolSettingsListSchema.parse(listAgentToolSettings(scope, database, aiRuntime, mcp));

  diagnosticIpcMain.handle(AGENT_TOOL_SETTINGS_CHANNELS.list, (_event, value: unknown) =>
    list(parseRequest(agentToolScopeRequestSchema, value).scope),
  );
  diagnosticIpcMain.handle(AGENT_TOOL_SETTINGS_CHANNELS.setEnabled, (_event, value: unknown) => {
    const request = parseRequest(setAgentToolEnabledSchema, value);
    if (!list(request.scope).some(row => row.id === request.id && row.configurable)) {
      throw new OperationRejected("operation-not-allowed");
    }
    database.setAgentToolEnabled(request);
    return list(request.scope);
  });
}
