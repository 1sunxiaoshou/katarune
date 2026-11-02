import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { McpService, mcpToolName } from "../src/main/mcp/mcpService";
import type { StoredMcpServer } from "../src/main/database/mcpRepository";
import { mcpSaveRequestSchema, type McpSaveRequest } from "../src/shared/mcp";

const fixture = resolve("tests/fixtures/mcp-server.mjs");
const services: McpService[] = [];
const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  await Promise.all(services.splice(0).map(service => service.close()));
  for (const close of cleanup.splice(0)) await close();
  vi.unstubAllEnvs();
});

function createService(idleMs?: number) {
  const configs = new Map<string, StoredMcpServer>();
  const secrets = new Map<string, string>();
  const repository = {
    listMcpConfigs: () => [...configs.values()].map(config => structuredClone(config)),
    fetchMcpConfig: (id: string) => {
      const config = configs.get(id);
      if (!config) throw new Error("Missing fixture configuration");
      return structuredClone(config);
    },
    saveMcpConfig: (config: StoredMcpServer) => { configs.set(config.id, structuredClone(config)); },
    deleteMcpConfig: (id: string) => { configs.delete(id); },
  };
  const credentials = {
    put: vi.fn(async (secret: string) => { const id = randomUUID(); secrets.set(id, secret); return id; }),
    resolve: vi.fn(async (id: string) => { const value = secrets.get(id); if (value === undefined) throw new Error("Missing fixture credential"); return value; }),
    delete: vi.fn(async (id: string) => { secrets.delete(id); }),
  };
  const service = new McpService(repository, credentials, idleMs);
  services.push(service);
  return { service, configs, secrets, credentials, repository };
}

function stdioRequest(overrides: Partial<McpSaveRequest> = {}): McpSaveRequest {
  return { name: "Fixture", enabled: true, transport: { type: "stdio", command: process.execPath, args: [fixture], env: [], envVars: [], cwd: "" }, ...overrides };
}

async function invoke(tools: Awaited<ReturnType<McpService["tools"]>>, id: string, name: string, input: Record<string, unknown> = {}, signal = new AbortController().signal) {
  const selected = tools[mcpToolName(id, name)];
  if (!selected?.execute || selected.type !== "dynamic") throw new Error("Missing fixture tool");
  return selected.execute(input, { toolCallId: randomUUID(), messages: [], abortSignal: signal, context: {} });
}

async function httpFixture(rejectAuth = false) {
  const sessions = new Map<string, number>();
  const authorizations: (string | undefined)[] = [];
  let calls = 0;
  const server = createServer(async (request, response) => {
    authorizations.push(request.headers.authorization);
    if (rejectAuth) { response.writeHead(401); response.end(); return; }
    if (request.method === "GET") { response.writeHead(405); response.end(); return; }
    if (request.method === "DELETE") { response.writeHead(204); response.end(); return; }
    let body = "";
    for await (const chunk of request) body += String(chunk);
    const message = z.object({ id: z.union([z.number(), z.string()]).optional(), method: z.string(), params: z.unknown().optional() }).parse(JSON.parse(body));
    if (message.id === undefined) { response.writeHead(204); response.end(); return; }
    let session = request.headers["mcp-session-id"];
    if (typeof session !== "string") session = randomUUID();
    response.setHeader("content-type", "application/json");
    response.setHeader("mcp-session-id", session);
    let result: unknown;
    if (message.method === "server/discover") {
      response.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Method not found" } })); return;
    } else if (message.method === "initialize") {
      sessions.set(session, 0);
      result = { protocolVersion: "2025-11-25", capabilities: { tools: {} }, serverInfo: { name: "http-fixture", version: "1.0.0" } };
    } else if (message.method === "tools/list") {
      result = { tools: [{ name: "increment", description: "Fixture counter", inputSchema: { type: "object", properties: {} } }] };
    } else if (message.method === "tools/call") {
      calls++;
      const count = (sessions.get(session) ?? 0) + 1;
      sessions.set(session, count);
      result = { content: [{ type: "text", text: String(count) }] };
    } else result = {};
    response.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
  });
  await new Promise<void>(resolveListen => server.listen(0, "127.0.0.1", resolveListen));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fixture listen failed");
  cleanup.push(async () => { server.closeAllConnections(); await new Promise<void>(resolveClose => server.close(() => resolveClose())); });
  return { url: `http://127.0.0.1:${address.port}/mcp`, authorizations, calls: () => calls };
}

describe("MCP management and execution", () => {
  it("keeps credentials out of persisted configuration and public responses, preserves edits and removes deleted secrets", async () => {
    const { service, configs, secrets } = createService();
    const saved = await service.save({ name: "Private", enabled: false, transport: { type: "http", url: "https://example.invalid/mcp", headers: [{ key: "X-Fixture", value: "synthetic-header" }], bearerToken: "synthetic-token" } });
    expect(JSON.stringify([...configs.values()])).not.toContain("synthetic-");
    expect(JSON.stringify(saved)).not.toContain("synthetic-");
    expect(secrets.size).toBe(1);
    await service.save({ id: saved.id, name: "Renamed", enabled: false, transport: { type: "http", url: "https://example.invalid/mcp", headers: [{ key: "X-Fixture" }] } });
    expect([...secrets.values()][0]).toContain("synthetic-header");
    expect([...secrets.values()][0]).toContain("synthetic-token");
    expect(secrets.size).toBe(1);
    await service.save({ id: saved.id, name: "Renamed", enabled: false, transport: { type: "http", url: "https://example.invalid/mcp", headers: [], bearerToken: "" } });
    expect(secrets.size).toBe(0);
    await service.remove(saved.id);
    expect(service.list()).toEqual([]);
  });

  it("does not overwrite configuration or leak newly written credentials when persistence fails", async () => {
    const { service, repository, secrets } = createService();
    const fail = vi.spyOn(repository, "saveMcpConfig").mockImplementationOnce(() => { throw new Error("Fixture disk failure"); });
    await expect(service.save({ name: "Private", enabled: false, transport: { type: "http", url: "https://example.invalid/mcp", headers: [], bearerToken: "synthetic-token" } })).rejects.toThrow();
    expect(secrets.size).toBe(0);
    expect(service.list()).toEqual([]);
    fail.mockRestore();
  });

  it("rejects duplicate names, header injection, invalid URLs, relative working directories and missing new secret values", async () => {
    const { service } = createService();
    const saved = await service.save(stdioRequest({ enabled: false }));
    await expect(service.save(stdioRequest({ enabled: false, name: "fixture" }))).rejects.toThrow("同名");
    expect(mcpSaveRequestSchema.safeParse({ name: "bad", enabled: true, transport: { type: "http", url: "file:///invalid", headers: [] } }).success).toBe(false);
    expect(mcpSaveRequestSchema.safeParse({ name: "bad", enabled: true, transport: { type: "http", url: "https://example.invalid", headers: [{ key: "Authorization", value: "x\r\ny" }] } }).success).toBe(false);
    await expect(service.save({ id: saved.id, name: "Fixture", enabled: false, transport: { type: "stdio", command: "node", args: [], env: [], envVars: [], cwd: "relative" } })).rejects.toThrow("绝对路径");
    await expect(service.save({ name: "Empty credential", enabled: false, transport: { type: "http", url: "https://example.invalid/mcp", headers: [{ key: "X-New" }] } })).rejects.toThrow("填写值");
  });

  it("discovers real stdio tools, reuses each conversation connection and isolates state between conversations", async () => {
    const { service } = createService();
    const saved = await service.save(stdioRequest());
    expect(saved.status).toBe("connected");
    expect(saved.tools.some(tool => tool.name === "increment")).toBe(true);
    const tools = await service.tools("first", new AbortController().signal);
    expect(await invoke(tools, saved.id, "increment")).toMatchObject({ content: [{ text: "1" }] });
    const again = await service.tools("first", new AbortController().signal);
    expect(await invoke(again, saved.id, "increment")).toMatchObject({ content: [{ text: "2" }] });
    const other = await service.tools("second", new AbortController().signal);
    expect(await invoke(other, saved.id, "increment")).toMatchObject({ content: [{ text: "1" }] });
  }, 15_000);

  it("passes only selected environment variables and configured values", async () => {
    vi.stubEnv("MCP_FIXTURE_INHERITED", "synthetic-inherited");
    vi.stubEnv("MCP_FIXTURE_HIDDEN", "synthetic-hidden");
    const { service } = createService();
    const saved = await service.save({ name: "Environment", enabled: true, transport: { type: "stdio", command: process.execPath, args: [fixture], cwd: "", envVars: ["MCP_FIXTURE_INHERITED"], env: [{ key: "MCP_FIXTURE_TOKEN", value: "synthetic-token" }] } });
    const tools = await service.tools("first", new AbortController().signal);
    expect(await invoke(tools, saved.id, "environment")).toMatchObject({ content: [{ text: JSON.stringify({ configured: true, inherited: true, hidden: true }) }] });
  }, 15_000);

  it("connects HTTP with encrypted credentials and never replays calls", async () => {
    const remote = await httpFixture();
    const { service } = createService();
    const saved = await service.save({ name: "HTTP", enabled: true, transport: { type: "http", url: remote.url, headers: [], bearerToken: "synthetic-token" } });
    expect(saved.status).toBe("connected");
    const tools = await service.tools("http-thread", new AbortController().signal);
    expect(await invoke(tools, saved.id, "increment")).toMatchObject({ content: [{ text: "1" }] });
    expect(remote.calls()).toBe(1);
    expect(remote.authorizations.every(value => value === "Bearer synthetic-token")).toBe(true);
  });

  it("shows authentication failures without exposing response or credential contents", async () => {
    const remote = await httpFixture(true);
    const { service } = createService();
    const saved = await service.save({ name: "HTTP", enabled: true, transport: { type: "http", url: remote.url, headers: [], bearerToken: "synthetic-token" } });
    expect(saved.status).toBe("auth-required");
    expect(saved.error).toContain("认证");
    expect(JSON.stringify(saved)).not.toContain("synthetic-token");
    expect(await service.tools("failed-thread", new AbortController().signal)).toEqual({});
  });

  it("invalidates old tools and cancels in-flight execution when globally disabled", async () => {
    const { service } = createService();
    const saved = await service.save(stdioRequest());
    const tools = await service.tools("first", new AbortController().signal);
    const running = invoke(tools, saved.id, "slow", { delay: 30_000 });
    const rejection = expect(running).rejects.toThrow(/取消|超时|失败/);
    await new Promise(resolveWait => setTimeout(resolveWait, 60));
    expect((await service.setEnabled(saved.id, false)).status).toBe("disabled");
    await rejection;
    await expect(invoke(tools, saved.id, "increment")).rejects.toThrow();
    expect(await service.tools("other", new AbortController().signal)).toEqual({});
    expect((await service.setEnabled(saved.id, true)).status).toBe("connected");
    await expect(invoke(tools, saved.id, "increment")).rejects.toThrow();
  }, 15_000);

  it("cancels a conversation call without affecting a different conversation", async () => {
    const { service } = createService();
    const saved = await service.save(stdioRequest());
    const controller = new AbortController();
    const first = await service.tools("first", controller.signal);
    const second = await service.tools("second", new AbortController().signal);
    const running = invoke(first, saved.id, "slow", { delay: 30_000 });
    const rejection = expect(running).rejects.toThrow(/取消|超时/);
    controller.abort();
    await rejection;
    expect(await invoke(second, saved.id, "increment")).toMatchObject({ content: [{ text: "1" }] });
  }, 15_000);

  it("closes the owned Windows server process tree on shutdown", async () => {
    if (process.platform !== "win32") return;
    const directory = await mkdtemp(join(tmpdir(), "katarune-mcp-"));
    cleanup.push(() => rm(directory, { recursive: true, force: true }));
    const pidFile = join(directory, "pid.json");
    const { service } = createService();
    const saved = await service.save({ name: "Process tree", enabled: true, transport: { type: "stdio", command: process.execPath, args: [fixture], cwd: "", envVars: [], env: [{ key: "MCP_FIXTURE_PID_FILE", value: pidFile }] } });
    expect(saved.status).toBe("connected");
    const pids = z.object({ pid: z.number(), child: z.number() }).parse(JSON.parse(await readFile(pidFile, "utf8")));
    await service.close();
    for (const pid of [pids.pid, pids.child]) expect(() => process.kill(pid, 0)).toThrow();
  }, 15_000);

  it("reports missing executables safely and keeps names provider-compatible", async () => {
    const { service } = createService();
    const saved = await service.save({ name: "Missing", enabled: true, transport: { type: "stdio", command: "katarune-mcp-fixture-missing-executable", args: [], env: [], envVars: [], cwd: "" } });
    expect(saved.status).toBe("error");
    expect(saved.error).toContain("找不到");
    const name = mcpToolName(saved.id, "tool / 中文及任意字符".repeat(20));
    expect(name).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    expect(name).not.toBe(mcpToolName(randomUUID(), "tool / 中文及任意字符".repeat(20)));
  });
});
