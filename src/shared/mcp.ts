import { z } from "zod";

const line = z.string().max(8192).refine(value => !/[\r\n\0]/.test(value), "不能包含换行或空字符。");
const envKey = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/).max(256);
const headerKey = z.string().regex(/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/).max(256);
const pairs = (key: typeof envKey) => z.array(z.strictObject({ key, value: line.optional() })).max(100)
  .refine(entries => new Set(entries.map(entry => entry.key.toLowerCase())).size === entries.length, "名称不能重复。");
const url = z.url().max(8192).refine(value => {
  const parsed = new URL(value);
  return ["http:", "https:"].includes(parsed.protocol) && !parsed.username && !parsed.password && !parsed.hash;
}, "请填写不含用户名、密码和片段的 HTTP(S) 地址。");
const workingDirectory = line.refine(value => !value || /^(?:[a-zA-Z]:[\\/]|[\\/])/.test(value), "工作目录需要使用绝对路径。");
export { envKey as mcpEnvironmentKeySchema, headerKey as mcpHeaderKeySchema, url as mcpHttpUrlSchema, workingDirectory as mcpWorkingDirectorySchema };

export const mcpSaveRequestSchema = z.strictObject({
  id: z.uuid().optional(),
  name: z.string().trim().min(1).max(80),
  enabled: z.boolean(),
  transport: z.discriminatedUnion("type", [
    z.strictObject({ type: z.literal("stdio"), command: line.refine(value => value.trim().length > 0),
      args: z.array(line).max(100), env: pairs(envKey), envVars: z.array(envKey).max(100), cwd: workingDirectory }),
    z.strictObject({ type: z.literal("http"), url, headers: pairs(headerKey), bearerToken: line.optional() }),
  ]),
});

export const mcpServerConfigSchema = z.strictObject({
  id: z.uuid(), name: z.string().min(1).max(80), enabled: z.boolean(),
  transport: z.discriminatedUnion("type", [
    z.strictObject({ type: z.literal("stdio"), command: line, args: z.array(line), envKeys: z.array(envKey), envVars: z.array(envKey), cwd: line }),
    z.strictObject({ type: z.literal("http"), url, headerKeys: z.array(headerKey), hasBearerToken: z.boolean() }),
  ]),
});
export const mcpToolInfoSchema = z.strictObject({ name: z.string(), modelName: z.string(), description: z.string() });
export const mcpServerSchema = mcpServerConfigSchema.extend({
  status: z.enum(["disabled", "disconnected", "connecting", "connected", "auth-required", "error"]),
  error: z.string().nullable(), tools: z.array(mcpToolInfoSchema),
});
export const mcpServerListSchema = z.array(mcpServerSchema);
export const mcpIdRequestSchema = z.strictObject({ id: z.uuid() });
export const mcpEnabledRequestSchema = mcpIdRequestSchema.extend({ enabled: z.boolean() });
export const MCP_CHANNELS = {
  list: "mcp:list", save: "mcp:save", remove: "mcp:remove", enabled: "mcp:enabled", connect: "mcp:connect",
} as const;
export type McpSaveRequest = z.infer<typeof mcpSaveRequestSchema>;
export type McpServerConfig = z.infer<typeof mcpServerConfigSchema>;
export type McpServer = z.infer<typeof mcpServerSchema>;
export type McpToolInfo = z.infer<typeof mcpToolInfoSchema>;
export interface McpApi {
  listMcpServers(): Promise<McpServer[]>;
  saveMcpServer(request: McpSaveRequest): Promise<McpServer>;
  deleteMcpServer(request: z.infer<typeof mcpIdRequestSchema>): Promise<void>;
  setMcpServerEnabled(request: z.infer<typeof mcpEnabledRequestSchema>): Promise<McpServer>;
  connectMcpServer(request: z.infer<typeof mcpIdRequestSchema>): Promise<McpServer>;
}
