import { randomUUID, createHash } from "node:crypto";
import { isAbsolute } from "node:path";
import { createMCPClient, type MCPClient } from "@ai-sdk/mcp";
import { dynamicTool, type ToolSet } from "ai";
import { z } from "zod";
import { mcpSaveRequestSchema, type McpSaveRequest, type McpServer, type McpServerConfig, type McpToolInfo } from "../../shared/mcp";
import type { createMcpRepository, StoredMcpServer } from "../database/mcpRepository";
import type { CredentialStore } from "../security/credentialStore";
import { OperationRejected } from "../diagnostics/operationRejected";
import { ManagedStdioTransport } from "./stdioTransport";

type McpRepository = ReturnType<typeof createMcpRepository>;
const secretSchema = z.strictObject({ env: z.record(z.string(), z.string()), headers: z.record(z.string(), z.string()), bearerToken: z.string() });
type Secrets = z.infer<typeof secretSchema>;
const emptySecrets = (): Secrets => ({ env: {}, headers: {}, bearerToken: "" });
type Connection = {
  serverId: string; scope: string; key: string; version: number; controller: AbortController;
  ready: Promise<{ client: MCPClient; tools: ToolSet }>;
  client?: MCPClient; transport?: ManagedStdioTransport; timer?: ReturnType<typeof setTimeout>;
  startupError?: ConnectionState;
  active: number;
};
type ConnectionState = Pick<McpServer, "status" | "error" | "tools">;

function connectionError(error: unknown): ConnectionState {
  // External errors can contain arguments, paths, headers or credentials. Never forward them.
  let message = "";
  let cause = error;
  for (let depth = 0; depth < 6; depth++) {
    const part = z.object({ name: z.string().optional(), message: z.string().optional(), code: z.union([z.string(), z.number()]).optional(), cause: z.unknown().optional() }).safeParse(cause);
    if (!part.success) break;
    message += ` ${part.data.name ?? ""} ${part.data.message ?? ""} ${part.data.code ?? ""}`;
    cause = part.data.cause;
  }
  if (/unauthoriz|\b401\b|\b403\b|authentication/i.test(message)) return {
    status: "auth-required", error: "需要认证，请检查 Bearer Token 或请求头；首版暂不支持 OAuth 登录。", tools: [],
  };
  return { status: "error", tools: [], error: /ENOENT/i.test(message)
    ? "找不到启动程序或工作目录，请检查配置和本机运行环境。"
    : /timeout|timed out/i.test(message) ? "连接超时，请检查服务是否正常运行。"
      : "连接失败，请检查命令、地址、认证信息及服务是否支持 MCP。" };
}

export function mcpToolName(serverId: string, original: string): string {
  // Provider tool names must be short and portable. The original remains in SDK metadata.
  return `mcp_${serverId.replaceAll("-", "")}_${createHash("sha256").update(original).digest("hex").slice(0, 20)}`;
}

export class McpService {
  #connections = new Map<string, Connection>();
  #states = new Map<string, ConnectionState>();
  #versions = new Map<string, number>();
  #mutations: Promise<unknown> = Promise.resolve();
  #closed = false;

  constructor(private readonly repository: McpRepository, private readonly credentials: CredentialStore,
    private readonly idleMs = 5 * 60_000) {}

  list(): McpServer[] {
    return this.repository.listMcpConfigs().map(config => this.#public(config));
  }

  #public(config: StoredMcpServer): McpServer {
    const { credentialRef: _credentialRef, ...publicConfig } = config;
    return { ...publicConfig, ...(config.enabled
      ? this.#states.get(config.id) ?? { status: "disconnected", error: null, tools: [] }
      : { status: "disabled", error: null, tools: [] }) };
  }

  #assertOpen(): void {
    if (this.#closed) throw new OperationRejected("operation-not-allowed");
  }

  #serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#mutations.then(() => { this.#assertOpen(); return operation(); });
    this.#mutations = result.catch(() => undefined);
    return result;
  }

  async #secrets(config: StoredMcpServer | undefined): Promise<Secrets> {
    return config?.credentialRef ? secretSchema.parse(JSON.parse(await this.credentials.resolve(config.credentialRef))) : emptySecrets();
  }

  async save(value: McpSaveRequest): Promise<McpServer> {
    const request = mcpSaveRequestSchema.parse(value);
    const id = await this.#serial(async () => {
      const previous = request.id ? this.repository.fetchMcpConfig(request.id) : undefined;
      if (this.repository.listMcpConfigs().some(config => config.id !== request.id && config.name.toLowerCase() === request.name.toLowerCase())) {
        throw new OperationRejected("invalid-input", "已有同名 MCP 服务，请使用其他名称。");
      }
      const old = previous?.transport.type === request.transport.type ? await this.#secrets(previous) : emptySecrets();
      const secrets = emptySecrets();
      const resolvePairs = (pairs: { key: string; value?: string | undefined }[], existing: Record<string, string>) => Object.fromEntries(pairs.map(pair => {
        const value = pair.value ?? existing[pair.key];
        if (value === undefined) throw new OperationRejected("invalid-input", "新增的环境变量或请求头需要填写值。");
        return [pair.key, value];
      }));
      let transport: McpServerConfig["transport"];
      if (request.transport.type === "stdio") {
        const input = request.transport;
        if (input.cwd && !isAbsolute(input.cwd)) throw new OperationRejected("invalid-input", "工作目录需要使用绝对路径。");
        secrets.env = resolvePairs(input.env, old.env);
        transport = { type: "stdio", command: input.command, args: input.args, envKeys: Object.keys(secrets.env), envVars: [...new Set(input.envVars)], cwd: input.cwd };
      } else {
        const input = request.transport;
        secrets.headers = resolvePairs(input.headers, old.headers);
        secrets.bearerToken = input.bearerToken ?? old.bearerToken;
        if (secrets.bearerToken && input.headers.some(header => header.key.toLowerCase() === "authorization")) {
          throw new OperationRejected("invalid-input", "Bearer Token 与 Authorization 请求头只能配置一种。");
        }
        transport = { type: "http", url: input.url, headerKeys: Object.keys(secrets.headers), hasBearerToken: !!secrets.bearerToken };
      }
      const credentialRef = Object.keys(secrets.env).length || Object.keys(secrets.headers).length || secrets.bearerToken
        ? await this.credentials.put(JSON.stringify(secrets)) : null;
      const id = previous?.id ?? randomUUID();
      try {
        this.#assertOpen();
        this.repository.saveMcpConfig({ id, name: request.name, enabled: request.enabled, transport, credentialRef });
      } catch (error) {
        if (credentialRef) await this.credentials.delete(credentialRef);
        throw error;
      }
      await this.#invalidate(id);
      if (previous?.credentialRef) await this.credentials.delete(previous.credentialRef);
      return id;
    });
    return this.repository.fetchMcpConfig(id).enabled ? this.connect(id) : this.#public(this.repository.fetchMcpConfig(id));
  }

  async setEnabled(id: string, enabled: boolean): Promise<McpServer> {
    await this.#serial(async () => {
      const config = this.repository.fetchMcpConfig(id);
      this.repository.saveMcpConfig({ ...config, enabled });
      await this.#invalidate(id);
    });
    return enabled ? this.connect(id) : this.#public(this.repository.fetchMcpConfig(id));
  }

  async remove(id: string): Promise<void> {
    await this.#serial(async () => {
      const config = this.repository.fetchMcpConfig(id);
      this.repository.deleteMcpConfig(id);
      await this.#invalidate(id);
      if (config.credentialRef) await this.credentials.delete(config.credentialRef);
    });
  }

  async connect(id: string): Promise<McpServer> {
    this.#assertOpen();
    await this.#invalidate(id);
    const config = this.repository.fetchMcpConfig(id);
    if (config.enabled) {
      try { await this.#open(config, "settings").ready; } catch { /* Safe status is exposed below. */ }
    }
    return this.#public(this.repository.fetchMcpConfig(id));
  }

  #touch(connection: Connection): void {
    clearTimeout(connection.timer);
    if (connection.controller.signal.aborted || connection.active > 0) return;
    connection.timer = setTimeout(() => { void this.#close(connection); }, this.idleMs);
    connection.timer.unref();
  }

  async #close(connection: Connection): Promise<void> {
    connection.controller.abort();
    clearTimeout(connection.timer);
    if (this.#connections.get(connection.key) === connection) this.#connections.delete(connection.key);
    try {
      if (connection.client) await connection.client.close();
      else await connection.transport?.close();
    } catch { /* Closing never exposes external errors or prevents other cleanup. */ }
    if (![...this.#connections.values()].some(entry => entry.serverId === connection.serverId)) {
      const previous = this.#states.get(connection.serverId);
      if (previous?.status === "connected") this.#states.set(connection.serverId, { ...previous, status: "disconnected" });
    }
  }

  async #invalidate(id: string): Promise<void> {
    this.#versions.set(id, (this.#versions.get(id) ?? 0) + 1);
    this.#states.delete(id);
    await Promise.all([...this.#connections.values()].filter(connection => connection.serverId === id).map(connection => this.#close(connection)));
  }

  #open(config: StoredMcpServer, scope: string): Connection {
    this.#assertOpen();
    const key = JSON.stringify([config.id, scope]);
    const existing = this.#connections.get(key);
    if (existing) { this.#touch(existing); return existing; }
    const connection: Connection = { serverId: config.id, scope, key, version: this.#versions.get(config.id) ?? 0,
      controller: new AbortController(), active: 0, ready: Promise.resolve().then(() => this.#initialize(connection, config)) };
    this.#connections.set(key, connection);
    this.#states.set(config.id, { status: "connecting", error: null, tools: [] });
    return connection;
  }

  async #initialize(connection: Connection, config: StoredMcpServer): Promise<{ client: MCPClient; tools: ToolSet }> {
    try {
      const secrets = await this.#secrets(config);
      connection.controller.signal.throwIfAborted();
      const transport = config.transport;
      if (transport.type === "stdio") {
        const inherited = Object.fromEntries(transport.envVars.map(name => {
          const value = process.env[name];
          if (value === undefined) throw new Error("Requested environment variable is unavailable");
          return [name, value];
        }));
        connection.transport = new ManagedStdioTransport({ command: transport.command, args: transport.args,
          env: Object.fromEntries([...Object.entries(inherited), ...Object.entries(secrets.env)].map(([key, value]) => [process.platform === "win32" ? key.toUpperCase() : key, value])),
          stderr: "ignore", ...(transport.cwd ? { cwd: transport.cwd } : {}) });
      }
      const client = await createMCPClient({
        clientName: "Katarune",
        transport: connection.transport ?? { type: "http", url: transport.type === "http" ? transport.url : "",
          headers: { ...secrets.headers, ...(secrets.bearerToken ? { Authorization: `Bearer ${secrets.bearerToken}` } : {}) } },
        initializationOptions: { timeout: 10_000, signal: connection.controller.signal },
        onUncaughtError: error => {
          if (!connection.client) connection.startupError ??= connectionError(error);
          if (connection.client && !connection.controller.signal.aborted) {
            this.#states.set(config.id, connectionError(error));
            void this.#close(connection);
          }
        },
      });
      connection.client = client;
      connection.controller.signal.throwIfAborted();
      if (connection.transport) {
        const onclose = connection.transport.onclose;
        connection.transport.onclose = () => {
          onclose?.();
          if (!connection.controller.signal.aborted) {
            this.#states.set(config.id, { status: "error", error: "连接已断开，请重新连接。", tools: [] });
            void this.#close(connection);
          }
        };
      }
      const definitions = await client.listTools({ options: { timeout: 10_000, signal: connection.controller.signal } });
      const seen = new Set<string>();
      let cursor = definitions.nextCursor;
      while (cursor) {
        if (seen.has(cursor) || definitions.tools.length > 1000) throw new Error("MCP tool discovery limit exceeded");
        seen.add(cursor);
        const page = await client.listTools({ params: { cursor }, options: { timeout: 10_000, signal: connection.controller.signal } });
        definitions.tools.push(...page.tools);
        cursor = page.nextCursor;
      }
      if (definitions.tools.length > 1000) throw new Error("MCP tool discovery limit exceeded");
      this.#check(connection);
      const tools = client.toolsFromDefinitions(definitions);
      const info: McpToolInfo[] = Object.entries(tools).map(([name, tool]) => ({ name, modelName: mcpToolName(config.id, name), description: typeof tool.description === "string" ? tool.description : "" }));
      this.#states.set(config.id, { status: "connected", error: null, tools: info });
      this.#touch(connection);
      return { client, tools };
    } catch (error) {
      if (!connection.controller.signal.aborted) this.#states.set(config.id, connection.startupError ?? connectionError(error));
      await this.#close(connection);
      throw new Error("MCP 服务连接不可用，请在设置中检查连接状态。");
    }
  }

  #check(connection: Connection): void {
    connection.controller.signal.throwIfAborted();
    this.#assertOpen();
    const config = this.repository.fetchMcpConfig(connection.serverId);
    if (!config.enabled || connection.version !== (this.#versions.get(config.id) ?? 0)) throw new Error("MCP 服务已停用或配置已变更。");
  }

  async tools(threadId: string, signal: AbortSignal): Promise<Record<string, ReturnType<typeof dynamicTool>>> {
    this.#assertOpen();
    signal.throwIfAborted();
    const sets = await Promise.all(this.repository.listMcpConfigs().filter(config => config.enabled).map(async config => {
      const connection = this.#open(config, `thread:${threadId}`);
      const cancel = () => { void this.#close(connection); };
      signal.addEventListener("abort", cancel, { once: true });
      try {
        const { tools } = await connection.ready;
        signal.throwIfAborted();
        return Object.fromEntries(Object.entries(tools).map(([name, sdkTool]) => {
          if (!sdkTool.inputSchema || !sdkTool.execute) throw new Error("MCP tool is unavailable");
          return [mcpToolName(config.id, name), dynamicTool({
          inputSchema: sdkTool.inputSchema,
          ...(sdkTool.metadata ? { metadata: sdkTool.metadata } : {}),
          ...(sdkTool.toModelOutput ? { toModelOutput: sdkTool.toModelOutput } : {}),
          title: `${config.name} · ${name}`,
          description: `[${config.name} / ${name}] ${typeof sdkTool.description === "string" ? sdkTool.description : ""}`,
          execute: async (input, options) => {
            this.#check(connection);
            const combined = AbortSignal.any([signal, connection.controller.signal, ...(options.abortSignal ? [options.abortSignal] : []), AbortSignal.timeout(60_000)]);
            combined.throwIfAborted();
            connection.active++;
            clearTimeout(connection.timer);
            try {
              if (!sdkTool.execute) throw new Error("MCP tool is unavailable");
              const result = await sdkTool.execute(input, { ...options, abortSignal: combined });
              combined.throwIfAborted();
              this.#check(connection);
              return result;
            } catch {
              if (combined.aborted) await this.#close(connection);
              throw new Error(combined.aborted ? "MCP 调用已取消或超时；操作可能已经生效，请确认后再重试。" : "MCP 调用失败；请检查服务状态，确认操作结果后再重试。");
            } finally {
              connection.active--;
              this.#touch(connection);
            }
          },
        })]; }));
      } catch {
        return {};
      } finally {
        // Execution wrappers carry this run's signal. Only pending discovery needs a listener.
        signal.removeEventListener("abort", cancel);
      }
    }));
    signal.throwIfAborted();
    return Object.assign({}, ...sets);
  }

  async closeThread(threadId: string): Promise<void> {
    await Promise.all([...this.#connections.values()].filter(connection => connection.scope === `thread:${threadId}`).map(connection => this.#close(connection)));
  }

  async close(): Promise<void> {
    this.#closed = true;
    const connections = [...this.#connections.values()];
    await Promise.all(connections.map(connection => this.#close(connection)));
    await Promise.allSettled(connections.map(connection => connection.ready));
    await this.#mutations;
  }
}
