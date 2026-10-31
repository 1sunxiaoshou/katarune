import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { tool, ToolLoopAgent, type ModelMessage, type ToolSet, type UIMessage } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { z } from "zod";
import { AgentToolsService } from "../src/main/ai/agentTools";
import { ChatAttachmentRunBudget } from "../src/main/ai/chatAttachments";
import { findNativeBash } from "../src/main/ai/nativeBash";
import type { AgentAccessMode, DirectoryGrant } from "../src/shared/agentTools";
import { assetUrl, type Asset, type Character } from "../src/shared/ipc";

const characterId = "00000000-0000-4000-8000-000000000001";
const otherCharacterId = "00000000-0000-4000-8000-000000000002";
const assetId = "00000000-0000-4000-8000-000000000003";
const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "katarune-agent-tools-")); directories.push(directory);
  const modes = new Map<string, AgentAccessMode>();
  const grants = new Map<string, DirectoryGrant[]>();
  const characters = new Set([characterId, otherCharacterId]);
  const owners = new Map([["thread", characterId], ["another-thread", characterId], ["other-thread", otherCharacterId], ["not-yet-saved", characterId], ["live", characterId]]);
  const asset: Asset = { id: assetId, kind: "chat_attachment", status: "ready", originalName: "资料.txt", mimeType: "text/plain", byteSize: 8, sha256: "0".repeat(64), createdAt: new Date(), updatedAt: new Date() };
  const original = new TextEncoder().encode("原始资料");
  const database: ConstructorParameters<typeof AgentToolsService>[1] = {
    fetchCharacter(id): Character {
      if (!characters.has(id)) throw new Error("character not found");
      return { id, name: "测试角色", portraitAssetId: null, modelConfigId: null, speechModelConfigId: null, speechVoice: null, useDefaultSpeechModel: false, useDefaultSpeechVoice: false, systemPrompt: "", createdAt: new Date(), updatedAt: new Date() };
    },
    fetchThread(threadId, id) { this.fetchCharacter(id); if (owners.get(threadId) !== id) throw new Error("thread not owned"); return { remoteId: threadId, characterId: id, kind: threadId === "live" ? "live" : "chat", title: "测试", status: "regular", lastMessageAt: new Date() }; },
    fetchAssetSourcePath: () => null,
    fetchAsset(id) { if (id !== assetId) throw new Error("asset not found"); return asset; },
    fetchThreadChatAttachment(threadId, id, attachmentId) { if (threadId !== "thread" || id !== characterId || attachmentId !== assetId) throw new Error("attachment not owned"); return asset; },
    getThreadToolAccess(threadId, id) { this.fetchThread(threadId, id); return { mode: modes.get(threadId) ?? "request-approval", directories: grants.get(threadId) ?? [] }; },
    setThreadToolMode(threadId, id, mode) { this.fetchThread(threadId, id); modes.set(threadId, mode); },
    grantThreadDirectory(threadId, id, path, access) {
      this.fetchThread(threadId, id);
      const rows = grants.get(threadId) ?? []; const grant = { id: rows.find(row => row.path === path)?.id ?? randomUUID(), path, access };
      grants.set(threadId, [...rows.filter(row => row.path !== path), grant]); return grant;
    },
    revokeThreadDirectory(threadId, id, grantId) { this.fetchThread(threadId, id); grants.set(threadId, (grants.get(threadId) ?? []).filter(row => row.id !== grantId)); },
  };
  const assets = { resolveManagedPath: (id: string) => join(directory, "assets", id), readChatAttachment: () => ({ data: original, filename: "资料.txt", mediaType: "text/plain" }) };
  const service = new AgentToolsService(join(directory, "workspaces"), database, assets);
  const prepare = (id = characterId, threadId = id === characterId ? "thread" : "other-thread", messages: UIMessage[] = [], signal = new AbortController().signal) => service.prepare({ characterId: id, threadId, messages,
    imageProcessor: { prepare: (data, mediaType) => ({ data, mediaType }) }, budget: new ChatAttachmentRunBudget(), signal });
  const outside = join(directory, "external"); await mkdir(outside); await writeFile(join(outside, "source.txt"), "outside");
  return { service, prepare, directory, outside, database, original, assets };
}

async function execute(tools: ToolSet, name: string, input: unknown, toolCallId: string = randomUUID()) {
  const action = tools[name]?.execute; if (!action) throw new Error(`missing tool ${name}`);
  return action(input, { toolCallId, messages: [], context: undefined, abortSignal: new AbortController().signal });
}
const bashResult = z.object({ stdout: z.string(), stderr: z.string(), exitCode: z.number() });
const run = async (tools: ToolSet, command: string) => bashResult.parse(await execute(tools, "bash", { command }));

describe("character Bash workspaces", () => {
  it("delivers workspace files and owned attachments while rejecting escapes and revoked grants", async () => {
    const f = await fixture();
    const workspace = await f.service.workspace(characterId);
    await writeFile(join(workspace, "report.txt"), "report");
    expect(new TextDecoder().decode((await f.service.readChatFile(characterId, "thread", { path: "report.txt" })).data)).toBe("report");
    expect(await f.service.readChatFile(characterId, "thread", { path: "/workspace/report.txt" })).toMatchObject({ filename: "report.txt", path: join(workspace, "report.txt") });
    expect((await f.service.readChatFile(characterId, "thread", { attachmentId: assetId })).data).toEqual(f.original);
    await expect(f.service.readChatFile(characterId, "another-thread", { attachmentId: assetId })).rejects.toThrow();
    await expect(f.service.readChatFile(characterId, "thread", { path: join(f.outside, "source.txt") })).rejects.toThrow("已授权目录");
    await symlink(f.outside, join(workspace, "escape"), process.platform === "win32" ? "junction" : "dir");
    await expect(f.service.readChatFile(characterId, "thread", { path: "escape/source.txt" })).rejects.toThrow("已授权目录");
    const grant = await f.service.grantDirectory(characterId, "thread", f.outside, "read");
    expect((await f.service.readChatFile(characterId, "thread", { path: `/directories/${grant.id}/source.txt` })).filename).toBe("source.txt");
    f.service.revokeDirectory(characterId, "thread", grant.id);
    await expect(f.service.readChatFile(characterId, "thread", { path: `/directories/${grant.id}/source.txt` })).rejects.toThrow("尚未获得");
    await expect(f.service.readChatFile(characterId, "live", { path: "report.txt" })).rejects.toThrow("私人聊天");
  });
  it("persists workspace files, isolates characters, and disables network and native programs", async () => {
    const f = await fixture(); const first = await f.prepare();
    expect((await run(first.tools, "printf 'saved' > note.txt; cat note.txt")).stdout).toBe("saved");
    const restarted = new AgentToolsService(join(f.directory, "workspaces"), f.database, f.assets);
    const second = await restarted.prepare({ characterId, threadId: "thread", messages: [], imageProcessor: { prepare: (data, mediaType) => ({ data, mediaType }) }, budget: new ChatAttachmentRunBudget(), signal: new AbortController().signal });
    expect((await run(second.tools, "cat note.txt")).stdout).toBe("saved");
    expect((await run((await f.prepare(otherCharacterId)).tools, "cat note.txt")).exitCode).not.toBe(0);
    expect((await run(first.tools, "curl https://example.com")).exitCode).not.toBe(0);
    expect((await run(first.tools, "node -e 'console.log(1)'")).exitCode).not.toBe(0);
  });

  it("blocks absolute paths, traversal and a workspace junction to an unauthorized directory", async () => {
    const f = await fixture(); const tools = (await f.prepare()).tools;
    const outside = join(f.outside, "source.txt").replaceAll("\\", "/");
    expect((await run(tools, `cat '${outside}'`)).stdout).not.toContain("outside");
    expect((await run(tools, "cat ../external/source.txt")).exitCode).not.toBe(0);
    await symlink(f.outside, join(await f.service.workspace(characterId), "escape"), process.platform === "win32" ? "junction" : "dir");
    expect((await run(tools, "cat escape/source.txt")).stdout).not.toContain("outside");
  });

  it("enforces read-only grants, upgrades explicitly and revokes access on the next command", async () => {
    const f = await fixture(); const tools = (await f.prepare()).tools;
    const grant = await f.service.grantDirectory(characterId, "thread", f.outside, "read");
    expect((await run(tools, `cat /directories/${grant.id}/source.txt`)).stdout).toBe("outside");
    await expect(run(tools, `echo changed > /directories/${grant.id}/source.txt`)).rejects.toThrow("read-only");
    expect(await readFile(join(f.outside, "source.txt"), "utf8")).toBe("outside");
    await f.service.grantDirectory(characterId, "thread", f.outside, "read-write");
    expect((await run(tools, `echo changed > /directories/${grant.id}/source.txt`)).exitCode).toBe(0);
    f.service.revokeDirectory(characterId, "thread", grant.id);
    expect((await run(tools, `cat /directories/${grant.id}/source.txt`)).exitCode).not.toBe(0);
  });

  it("shares the character workspace while keeping directory grants inside one conversation", async () => {
    const f = await fixture();
    const first = await f.prepare();
    const second = await f.prepare(characterId, "another-thread");
    await run(first.tools, "printf shared > shared.txt");
    expect((await run(second.tools, "cat shared.txt")).stdout).toBe("shared");
    const grant = await f.service.grantDirectory(characterId, "thread", f.outside, "read");
    expect((await run(first.tools, `cat /directories/${grant.id}/source.txt`)).stdout).toBe("outside");
    expect((await run(second.tools, `cat /directories/${grant.id}/source.txt`)).exitCode).not.toBe(0);
    f.service.revokeDirectory(characterId, "another-thread", grant.id);
    expect(f.service.state(characterId, "thread").directories).toHaveLength(1);
    expect(f.service.state(characterId, "another-thread").directories).toHaveLength(0);
    expect(() => f.service.setMode(otherCharacterId, "thread", "request-approval")).toThrow("thread not owned");
    expect(f.service.state(characterId).mode).toBe("request-approval");
  });

  it("treats sent files as read-only authorized paths without exposing their source directory", async () => {
    const f = await fixture(); const messages: UIMessage[] = [{ id: "sent", role: "user", parts: [{ type: "file", filename: "资料.txt", mediaType: "text/plain", url: assetUrl(assetId) }] }];
    const prepared = await f.prepare(characterId, "thread", messages);
    expect((await run(prepared.tools, `cat '/attachments/${assetId}/资料.txt'`)).stdout).toBe("原始资料");
    await expect(run(prepared.tools, `echo edited > '/attachments/${assetId}/资料.txt'`)).rejects.toThrow("只允许读取");
    expect(prepared.tools.load_chat_attachment).toBeUndefined();
    expect(new TextDecoder().decode(f.original)).toBe("原始资料");
    expect((await run((await f.prepare(otherCharacterId)).tools, `cat /attachments/${assetId}/资料.txt`)).exitCode).not.toBe(0);
    for (const originalName of [".", "..", "bad\0name"]) {
      Object.assign(f.database.fetchAsset(assetId), { originalName });
      await expect(f.prepare(characterId, "thread", messages)).rejects.toThrow("附件文件名无效");
    }
  });

  it("keeps image bytes out of persisted results and checks filesystem grants before viewing", async () => {
    const f = await fixture(); const workspace = await f.service.workspace(characterId); await writeFile(join(workspace, "test.png"), new Uint8Array([1, 2, 3]));
    const prepared = await f.prepare();
    const result = await execute(prepared.tools, "view_image", { path: "test.png" }, "image");
    expect(result).toEqual({ status: "loaded", filename: "test.png", mediaType: "image/png", sourceByteSize: 3 });
    const render = prepared.tools.view_image?.toModelOutput; if (!render) throw new Error("missing image output");
    expect(await render({ output: result, toolCallId: "image", input: { path: "test.png" } })).toMatchObject({ type: "content", value: expect.arrayContaining([expect.objectContaining({ type: "file", mediaType: "image/png", data: { type: "data", data: "AQID" } })]) });
    await writeFile(join(workspace, "test.png"), new Uint8Array([4, 5, 6]));
    const edited = await execute(prepared.tools, "view_image", { path: "test.png" }, "edited");
    expect(JSON.stringify(await render({ output: edited, toolCallId: "edited", input: { path: "test.png" } }))).toContain("BAUG");
    const grant = await f.service.grantDirectory(characterId, "thread", f.outside, "read");
    await writeFile(join(f.outside, "external.png"), new Uint8Array([7, 8, 9]));
    await expect(execute(prepared.tools, "view_image", { path: `/directories/${grant.id}/external.png` })).resolves.toMatchObject({ filename: "external.png" });
    f.service.revokeDirectory(characterId, "thread", grant.id);
    await expect(execute(prepared.tools, "view_image", { path: `/directories/${grant.id}/external.png` })).rejects.toThrow();
    await expect(execute(prepared.tools, "view_image", { path: join(f.outside, "source.txt") })).rejects.toThrow();
  });

  it("authorizes a newly imported file before framework history is saved, only for its importing character", async () => {
    const f = await fixture();
    const messages: UIMessage[] = [{ id: "first", role: "user", parts: [{ type: "file", mediaType: "text/plain", url: assetUrl(assetId) }] }];
    await expect(f.prepare(characterId, "not-yet-saved", messages)).rejects.toThrow("attachment not owned");
    f.service.authorizeImportedAttachment(characterId, assetId);
    const prepared = await f.prepare(characterId, "not-yet-saved", messages);
    expect((await run(prepared.tools, `cat '/attachments/${assetId}/资料.txt'`)).stdout).toBe("原始资料");
    await expect(f.prepare(otherCharacterId, "other-thread", messages)).rejects.toThrow("attachment not owned");
    await expect(f.prepare(characterId, "another-thread", messages)).rejects.toThrow("attachment not owned");
    f.service.forgetImportedAttachment(assetId);
    await expect(f.prepare(characterId, "not-yet-saved", messages)).rejects.toThrow("attachment not owned");
  });

  it("views attachment paths and lets Bash explicitly copy them for editing", async () => {
    const f = await fixture();
    Object.assign(f.database.fetchAsset(assetId), { originalName: "original.png", mimeType: "image/png" });
    vi.spyOn(f.assets, "readChatAttachment").mockReturnValue({ data: f.original, mediaType: "image/png", filename: "original.png" });
    const messages: UIMessage[] = [{ id: "image", role: "user", parts: [{ type: "file", mediaType: "image/png", url: assetUrl(assetId) }] }];
    const prepared = await f.prepare(characterId, "thread", messages);
    const path = `/attachments/${assetId}/original.png`;
    expect((await run(prepared.tools, `cp '${path}' edited.png; printf edited > edited.png`)).exitCode).toBe(0);
    expect(await execute(prepared.tools, "view_image", { path }, "original")).toMatchObject({ sourceByteSize: f.original.byteLength });
    expect(await execute(prepared.tools, "view_image", { path: "edited.png" }, "edited")).toMatchObject({ sourceByteSize: 6 });
    await expect(execute((await f.prepare(characterId, "another-thread")).tools, "view_image", { path })).rejects.toThrow();
  });

  it("does not expose workstation tools to public live threads", async () => {
    const f = await fixture(); await expect(f.prepare(characterId, "live")).rejects.toThrow("私人聊天");
  });
});

const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 1, text: 1, reasoning: undefined } };
it.each([true, false])("requires a signed approval before web access in request-approval mode (approved=%s)", async approved => {
  const f = await fixture(); const prepared = await f.prepare();
  const fetch = vi.fn(async () => ({ type: "document" as const, url: "https://example.com", finalUrl: "https://example.com", contentType: "text/plain", content: "fixture", offset: 0, totalLength: 7 }));
  const originalFetch = prepared.tools.fetch_url;
  if (!originalFetch) throw new Error("missing fetch tool");
  const tools: ToolSet = { ...prepared.tools, fetch_url: tool({ inputSchema: originalFetch.inputSchema, execute: fetch }) };
  let step = 0;
  const model = new MockLanguageModelV4({ doGenerate: async () => ({ content: ++step === 1
    ? [{ type: "tool-call", toolCallId: "network", toolName: "fetch_url", input: JSON.stringify({ url: "https://example.com" }) }]
    : [{ type: "text", text: "done" }], finishReason: { unified: step === 1 ? "tool-calls" : "stop", raw: undefined }, usage, warnings: [] }) });
  const agent = new ToolLoopAgent({ model, tools, toolApproval: prepared.toolApproval, experimental_toolApprovalSecret: prepared.approvalSecret });
  const first = await agent.generate({ prompt: "读取这个网页" });
  expect(fetch).not.toHaveBeenCalled();
  const approval = first.content.find(part => part.type === "tool-approval-request"); if (!approval) throw new Error("missing network approval");
  await agent.generate({ messages: [{ role: "user", content: "读取这个网页" }, ...first.responseMessages,
    { role: "tool", content: [{ type: "tool-approval-response", approvalId: approval.approvalId, approved }] }] });
  expect(fetch).toHaveBeenCalledTimes(approved ? 1 : 0);
});

it.each([true, false])("uses signed SDK approvals before granting a local directory (approved=%s)", async approved => {
  const f = await fixture(); const prepared = await f.prepare();
  let step = 0;
  const model = new MockLanguageModelV4({ doGenerate: async () => ({ content: ++step === 1
    ? [{ type: "tool-call", toolCallId: "directory", toolName: "request_directory_access", input: JSON.stringify({ path: f.outside, access: "read", reason: "读取指定资料" }) }]
    : [{ type: "text", text: "done" }], finishReason: { unified: step === 1 ? "tool-calls" : "stop", raw: undefined }, usage, warnings: [] }) });
  const agent = new ToolLoopAgent({ model, tools: prepared.tools, toolApproval: prepared.toolApproval, experimental_toolApprovalSecret: prepared.approvalSecret });
  const first = await agent.generate({ prompt: "读取资料" });
  expect(f.service.state(characterId, "thread").directories).toHaveLength(0);
  const approval = first.content.find(part => part.type === "tool-approval-request"); if (!approval) throw new Error("missing approval");
  const messages: ModelMessage[] = [{ role: "user", content: "读取资料" }, ...first.responseMessages,
    { role: "tool", content: [{ type: "tool-approval-response", approvalId: approval.approvalId, approved }] }];
  await agent.generate({ messages });
  expect(f.service.state(characterId, "thread").directories).toHaveLength(approved ? 1 : 0);
  if (approved) expect(f.service.state(characterId, "thread").directories[0]?.path).toBe(await realpath(f.outside));
});

it.skipIf(!findNativeBash())("runs on the local machine with filesystem and network access only in full-access mode", async () => {
  const f = await fixture(); f.service.setMode(characterId, "thread", "full-access"); const tools = (await f.prepare()).tools;
  expect(f.service.state(characterId, "another-thread").mode).toBe("request-approval");
  expect((await f.prepare(characterId, "another-thread")).toolApproval.fetch_url).toBe("user-approval");
  expect((await f.prepare()).toolApproval.fetch_url).toBe("approved");
  vi.spyOn(f.database, "fetchAssetSourcePath").mockReturnValue(join(f.outside, "source.txt"));
  const attached = await f.prepare(characterId, "thread", [{ id: "native-file", role: "user", parts: [{ type: "file", mediaType: "text/plain", url: assetUrl(assetId) }] }]);
  const attachedPath = attached.attachmentPaths.get(assetId);
  expect(attachedPath).toBeDefined();
  expect((await run(attached.tools, `cat '${attachedPath}'`)).stdout).toBe("outside");

  await execute(tools, "request_directory_access", { path: f.outside, access: "read-write", reason: "already unrestricted" });
  expect(f.service.state(characterId, "thread").directories).toHaveLength(0);
  const server = createServer((_request, response) => response.end("local-network"));
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address(); if (!address || typeof address === "string") throw new Error("missing port");
    expect((await run(tools, `curl -s --max-time 3 http://127.0.0.1:${address.port}/`)).stdout).toBe("local-network");
    await run(tools, `printf 'native' > ../native-result.txt`);
    expect(await readFile(join(f.directory, "workspaces", "native-result.txt"), "utf8")).toBe("native");
    f.service.setMode(characterId, "thread", "request-approval");
    await expect(run(tools, "printf forbidden")).rejects.toThrow("访问模式已改变");
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

it("rejects forged, cross-thread and replayed directory approvals", async () => {
  const f = await fixture(); const prepared = await f.prepare();
  let step = 0;
  const model = new MockLanguageModelV4({ doGenerate: async () => ({ content: ++step === 1
    ? [{ type: "tool-call", toolCallId: "one-grant", toolName: "request_directory_access", input: JSON.stringify({ path: f.outside, access: "read", reason: "读取资料" }) }]
    : [{ type: "text", text: "done" }], finishReason: { unified: step === 1 ? "tool-calls" : "stop", raw: undefined }, usage, warnings: [] }) });
  const agent = new ToolLoopAgent({ model, tools: prepared.tools, toolApproval: prepared.toolApproval, experimental_toolApprovalSecret: prepared.approvalSecret });
  const first = await agent.generate({ prompt: "读取资料" });
  const approval = first.content.find(part => part.type === "tool-approval-request"); if (!approval) throw new Error("missing approval");
  const history: ModelMessage[] = [{ role: "user", content: "读取资料" }, ...first.responseMessages,
    { role: "tool", content: [{ type: "tool-approval-response", approvalId: approval.approvalId, approved: true }] }];
  const tampered = structuredClone(history);
  for (const message of tampered) if (Array.isArray(message.content)) for (const part of message.content) if (part.type === "tool-call") part.input = { path: f.outside, access: "read-write", reason: "读取资料" };
  await expect(agent.generate({ messages: tampered })).rejects.toThrow("signature");
  expect(f.service.state(characterId, "thread").directories).toHaveLength(0);
  const other = await f.prepare(characterId, "another-thread");
  const otherAgent = new ToolLoopAgent({ model, tools: other.tools, toolApproval: other.toolApproval, experimental_toolApprovalSecret: other.approvalSecret });
  await expect(otherAgent.generate({ messages: history })).rejects.toThrow("signature");
  expect(f.service.state(characterId, "thread").directories).toHaveLength(0);
  await agent.generate({ messages: history });
  const grant = f.service.state(characterId, "thread").directories[0]; if (!grant) throw new Error("missing grant");
  f.service.revokeDirectory(characterId, "thread", grant.id);
  await agent.generate({ messages: history });
  expect(f.service.state(characterId, "thread").directories).toHaveLength(0);
});

it.skipIf(!findNativeBash())("terminates a running native command when the caller cancels", async () => {
  const f = await fixture(); f.service.setMode(characterId, "thread", "full-access");
  const controller = new AbortController(); const prepared = await f.prepare(characterId, "thread", [], controller.signal);
  const pending = run(prepared.tools, "sleep 20");
  const timer = setTimeout(() => controller.abort(), 100);
  try { await expect(pending).rejects.toThrow("取消"); } finally { clearTimeout(timer); }
}, 10_000);

it.skipIf(!findNativeBash())("changing one conversation's mode cancels its command without stopping another conversation", async () => {
  const f = await fixture();
  f.service.setMode(characterId, "thread", "full-access");
  f.service.setMode(characterId, "another-thread", "full-access");
  const first = await f.prepare();
  const second = await f.prepare(characterId, "another-thread");
  const cancelled = expect(run(first.tools, "sleep 20")).rejects.toThrow("取消");
  const unaffected = run(second.tools, "sleep 0.5; printf unaffected");
  const timer = setTimeout(() => f.service.setMode(characterId, "thread", "request-approval"), 100);
  try {
    await cancelled;
    expect((await unaffected).stdout).toBe("unaffected");
    expect(f.service.state(characterId, "another-thread").mode).toBe("full-access");
  } finally { clearTimeout(timer); }
}, 10_000);
