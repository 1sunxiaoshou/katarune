import { ipcRenderer } from "electron";
import { MCP_CHANNELS, mcpEnabledRequestSchema, mcpIdRequestSchema, mcpSaveRequestSchema, mcpServerListSchema, mcpServerSchema, type McpApi } from "../shared/mcp";

export const mcpApi: McpApi = {
  listMcpServers: async () => mcpServerListSchema.parse(await ipcRenderer.invoke(MCP_CHANNELS.list)),
  saveMcpServer: async request => mcpServerSchema.parse(await ipcRenderer.invoke(MCP_CHANNELS.save, mcpSaveRequestSchema.parse(request))),
  deleteMcpServer: async request => { await ipcRenderer.invoke(MCP_CHANNELS.remove, mcpIdRequestSchema.parse(request)); },
  setMcpServerEnabled: async request => mcpServerSchema.parse(await ipcRenderer.invoke(MCP_CHANNELS.enabled, mcpEnabledRequestSchema.parse(request))),
  connectMcpServer: async request => mcpServerSchema.parse(await ipcRenderer.invoke(MCP_CHANNELS.connect, mcpIdRequestSchema.parse(request))),
};
