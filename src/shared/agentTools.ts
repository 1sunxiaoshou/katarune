import { z } from "zod";

export const agentAccessModeSchema = z.enum(["request-approval", "full-access"]);
export const directoryAccessSchema = z.enum(["read", "read-write"]);
export const agentCharacterRequestSchema = z.strictObject({ characterId: z.uuid() });
export const agentThreadRequestSchema = agentCharacterRequestSchema.extend({ threadId: z.string().min(1).max(500) });
export const agentAccessRequestSchema = agentCharacterRequestSchema.extend({ threadId: z.string().min(1).max(500).optional() });
export const agentModeRequestSchema = agentThreadRequestSchema.extend({ mode: agentAccessModeSchema });
export const directoryAccessInputSchema = z.strictObject({
  path: z.string().min(1).max(4096),
  access: directoryAccessSchema,
  reason: z.string().min(1).max(500),
});
export const storedDirectoryGrantSchema = z.strictObject({
  id: z.uuid(), path: z.string().min(1).max(4096), access: directoryAccessSchema,
});
export const agentAccessStateSchema = z.strictObject({
  mode: agentAccessModeSchema,
  directories: z.array(storedDirectoryGrantSchema),
  nativeShellAvailable: z.boolean(),
});
export type AgentAccessMode = z.infer<typeof agentAccessModeSchema>;
export type DirectoryAccess = z.infer<typeof directoryAccessSchema>;
export type DirectoryGrant = z.infer<typeof storedDirectoryGrantSchema>;
export type AgentAccessState = z.infer<typeof agentAccessStateSchema>;
export const chatFileSourceSchema = z.union([
  z.strictObject({ attachmentId: z.uuid() }),
  z.strictObject({ path: z.string().min(1).max(4096) }),
]);
export const chatFileRequestSchema = agentThreadRequestSchema.extend({ source: chatFileSourceSchema, action: z.enum(["info", "preview", "open", "save"]) });
export const chatFileResultSchema = z.strictObject({ filename: z.string(), byteSize: z.number().nonnegative(), text: z.string().optional(), image: z.string().optional(), cancelled: z.boolean().optional() });
export type ChatFileSource = z.infer<typeof chatFileSourceSchema>;
export type ChatFileResult = z.infer<typeof chatFileResultSchema>;
export const AGENT_TOOL_CHANNELS = {
  get: "agent-tools:get", setMode: "agent-tools:set-mode",
  openWorkspace: "agent-tools:open-workspace",
  file: "agent-tools:file",
} as const;
export interface AgentToolsApi {
  accessChatFile(request: z.infer<typeof chatFileRequestSchema>): Promise<ChatFileResult>;
  getAgentAccess(request: z.infer<typeof agentAccessRequestSchema>): Promise<AgentAccessState>;
  setAgentAccessMode(request: z.infer<typeof agentModeRequestSchema>): Promise<AgentAccessState>;
  openAgentWorkspace(request: z.infer<typeof agentCharacterRequestSchema>): Promise<void>;
}
