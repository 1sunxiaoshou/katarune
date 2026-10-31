import { ipcRenderer } from "electron";
import { chatFileRequestSchema, chatFileResultSchema } from "../shared/agentTools";
import { AGENT_TOOL_CHANNELS, agentAccessStateSchema, agentAccessRequestSchema, agentCharacterRequestSchema, agentModeRequestSchema, type AgentToolsApi } from "../shared/agentTools";

export const agentToolsApi: AgentToolsApi = {
  accessChatFile: async request => chatFileResultSchema.parse(await ipcRenderer.invoke(AGENT_TOOL_CHANNELS.file, chatFileRequestSchema.parse(request))),
  getAgentAccess: async request => agentAccessStateSchema.parse(await ipcRenderer.invoke(AGENT_TOOL_CHANNELS.get, agentAccessRequestSchema.parse(request))),
  setAgentAccessMode: async request => agentAccessStateSchema.parse(await ipcRenderer.invoke(AGENT_TOOL_CHANNELS.setMode, agentModeRequestSchema.parse(request))),
  openAgentWorkspace: async request => { await ipcRenderer.invoke(AGENT_TOOL_CHANNELS.openWorkspace, agentCharacterRequestSchema.parse(request)); },
};
