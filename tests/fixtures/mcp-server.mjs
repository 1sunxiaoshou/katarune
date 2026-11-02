import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { z } from "zod";

const server = new McpServer({ name: "katarune-mcp-fixture", version: "1.0.0" });
let count = 0;
server.registerTool("increment", { description: "Increment this connection's fixture counter.", inputSchema: {} }, async () => ({ content: [{ type: "text", text: String(++count) }] }));
server.registerTool("environment", { description: "Inspect fixture environment without returning any values.", inputSchema: {} }, async () => ({ content: [{ type: "text", text: JSON.stringify({
  configured: process.env.MCP_FIXTURE_TOKEN === "synthetic-token", inherited: process.env.MCP_FIXTURE_INHERITED === "synthetic-inherited", hidden: process.env.MCP_FIXTURE_HIDDEN === undefined,
}) }] }));
server.registerTool("slow", { description: "Wait for cancellation.", inputSchema: { delay: z.number().min(1).max(30_000) } }, async ({ delay }, extra) => {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, delay);
    extra.signal.addEventListener("abort", () => { clearTimeout(timer); reject(new Error("Cancelled fixture")); }, { once: true });
  });
  return { content: [{ type: "text", text: "done" }] };
});
if (process.env.MCP_FIXTURE_PID_FILE) {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore", windowsHide: true, env: { ...process.env } });
  writeFileSync(process.env.MCP_FIXTURE_PID_FILE, JSON.stringify({ pid: process.pid, child: child.pid }));
}
await server.connect(new StdioServerTransport());
