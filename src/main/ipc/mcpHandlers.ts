import { MCP_CHANNELS, mcpEnabledRequestSchema, mcpIdRequestSchema, mcpSaveRequestSchema, mcpServerListSchema, mcpServerSchema } from "../../shared/mcp";
import type { McpService } from "../mcp/mcpService";
import { diagnosticIpcMain } from "../diagnostics/ipc";
import { parseRequest } from "../diagnostics/operationRejected";

export function registerMcpHandlers(service: McpService): void {
  diagnosticIpcMain.handle(MCP_CHANNELS.list, () => mcpServerListSchema.parse(service.list()));
  diagnosticIpcMain.handle(MCP_CHANNELS.save, async (_event, value: unknown) =>
    mcpServerSchema.parse(await service.save(parseRequest(mcpSaveRequestSchema, value))));
  diagnosticIpcMain.handle(MCP_CHANNELS.remove, async (_event, value: unknown) => {
    await service.remove(parseRequest(mcpIdRequestSchema, value).id);
  });
  diagnosticIpcMain.handle(MCP_CHANNELS.enabled, async (_event, value: unknown) => {
    const request = parseRequest(mcpEnabledRequestSchema, value);
    return mcpServerSchema.parse(await service.setEnabled(request.id, request.enabled));
  });
  diagnosticIpcMain.handle(MCP_CHANNELS.connect, async (_event, value: unknown) =>
    mcpServerSchema.parse(await service.connect(parseRequest(mcpIdRequestSchema, value).id)));
}
