import { agentToolEnabled, toolPolicyId, type AgentToolOverrides, type AgentToolScope, type AgentToolSettingsRow } from "../../shared/agentToolSettings";
import { providerToolEnabled } from "../../shared/providers";
import type { DatabaseRuntime } from "../database/database";
import type { McpService } from "../mcp/mcpService";
import type { AiRuntime } from "./runtime";
import { listNativeProviderTools } from "./toolkit";

type SystemTool = {
  readonly name: string;
  readonly scopes: readonly AgentToolScope[];
  readonly configurable?: false;
  readonly note?: string;
};

const SYSTEM_TOOLS: Readonly<Record<string, SystemTool>> = {
  get_current_time: { name: "时间", scopes: ["chat", "desktop", "live"] },
  memory: { name: "记忆", scopes: ["chat", "desktop", "live", "diary"] },
  view_image: { name: "看图", scopes: ["chat", "desktop"] },
  bash: { name: "Bash", scopes: ["chat", "desktop"] },
  request_directory_access: { name: "目录授权", scopes: ["chat", "desktop"], note: "调用时沿用会话的目录权限" },
  fetch_url: { name: "本地联网搜索", scopes: ["chat", "desktop", "live"], note: "读取公开网页链接" },
  performance: { name: "表演工具", scopes: ["desktop", "live"], note: "当前会话绑定角色时提供" },
  finish_diary: { name: "提交草稿", scopes: ["diary"], configurable: false },
};

export function systemToolEnabled(overrides: AgentToolOverrides | undefined, scope: AgentToolScope, name: string): boolean {
  const key = name === "avatar_perform" || name === "avatar_control" || name === "avatar_play" ? "performance" : name;
  const tool = Object.hasOwn(SYSTEM_TOOLS, key) ? SYSTEM_TOOLS[key] : undefined;
  if (!tool) return true;
  return tool.scopes.includes(scope) &&
    (tool.configurable === false || agentToolEnabled(overrides, scope, toolPolicyId("system", key)));
}

export function listAgentToolSettings(
  scope: AgentToolScope,
  database: Pick<DatabaseRuntime, "getAgentToolOverrides" | "listProviderConfigs">,
  aiRuntime: Pick<AiRuntime, "listProviderTools">,
  mcp?: Pick<McpService, "list">,
): AgentToolSettingsRow[] {
  const overrides = database.getAgentToolOverrides();
  const rows: AgentToolSettingsRow[] = [];
  const add = (row: Omit<AgentToolSettingsRow, "enabled">) => {
    rows.push({ ...row, enabled: !row.configurable || agentToolEnabled(overrides, scope, row.id) });
  };

  for (const [id, tool] of Object.entries(SYSTEM_TOOLS)) {
    if (!tool.scopes.includes(scope)) continue;
    add({
      id: toolPolicyId("system", id), name: tool.name, sourceId: "system", sourceName: "系统",
      configurable: tool.configurable ?? true, ...(tool.note === undefined ? {} : { note: tool.note }),
    });
  }
  if (scope === "diary") return rows;

  const providers = database.listProviderConfigs().providerConfigs;
  const configuredTypes = new Set<string>(providers.map(provider => provider.providerType));
  for (const tool of listNativeProviderTools()) {
    if (!configuredTypes.has(tool.provider) && !configuredTypes.has("gateway")) continue;
    add({
      id: toolPolicyId("native", tool.id), name: tool.name, sourceId: tool.provider, sourceName: tool.sourceName,
      configurable: true, note: "使用该供应商的兼容模型时提供",
    });
  }
  const providerTools = new Map<string, { row: Omit<AgentToolSettingsRow, "enabled">; enabledAtSource: boolean }>();
  for (const provider of providers) {
    for (const tool of aiRuntime.listProviderTools(provider.id, scope)) {
      const id = toolPolicyId("provider", tool.id);
      const enabledAtSource = provider.enabled && provider.credentialRef !== null && providerToolEnabled(provider.settings, tool.settingKey);
      const entry = providerTools.get(id);
      if (entry) {
        entry.enabledAtSource ||= enabledAtSource;
      } else {
        providerTools.set(id, { enabledAtSource, row: {
          id, name: tool.name, sourceId: provider.providerType,
          sourceName: provider.providerType === "deepseek" ? "DeepSeek" : provider.displayName,
          configurable: true,
        } });
      }
    }
  }
  for (const { row, enabledAtSource } of providerTools.values()) {
    add({ ...row, ...(!enabledAtSource ? { note: "需在供应商设置中启用" } : {}) });
  }
  if (scope === "live") return rows;
  for (const server of mcp?.list() ?? []) {
    for (const tool of server.tools) {
      add({ id: toolPolicyId("mcp", tool.modelName), name: tool.name, sourceId: "mcp",
        sourceName: "MCP", configurable: true, note: server.name });
    }
  }
  return rows;
}
