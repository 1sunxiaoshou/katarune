import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerAgentToolHandlers } from "../src/main/ipc/agentToolHandlers";
import { AGENT_TOOL_CHANNELS } from "../src/shared/agentTools";

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (event: { sender: object }, value: unknown) => Promise<unknown>>(),
  save: vi.fn(), open: vi.fn(),
}));
vi.mock("electron", () => ({ app: { getPath: () => "unused" }, BrowserWindow: { fromWebContents: () => ({}) }, dialog: { showSaveDialog: mocks.save }, shell: { openPath: mocks.open }, nativeImage: { createFromBuffer: vi.fn() } }));
vi.mock("../src/main/diagnostics/ipc", () => ({ diagnosticIpcMain: { handle: (name: string, fn: (event: { sender: object }, value: unknown) => Promise<unknown>) => mocks.handlers.set(name, fn) } }));

const directories: string[] = [];
afterEach(async () => { vi.clearAllMocks(); for (const dir of directories.splice(0)) await rm(dir, { recursive: true, force: true }); });
const request = { characterId: "00000000-0000-4000-8000-000000000001", threadId: "thread", source: { path: "report.txt" } };
function setup(path = join(tmpdir(), "report.txt")) {
  const read = vi.fn(async () => ({ filename: "report.txt", data: new TextEncoder().encode("report"), mediaType: "text/plain", path }));
  const state = () => ({ mode: "request-approval" as const, directories: [], nativeShellAvailable: false });
  registerAgentToolHandlers({ readChatFile: read, describeChatAttachment: () => ({ filename: "report.txt", byteSize: 6 }), state, setMode: state, workspace: async () => "unused" });
  const invoke = (value: unknown) => { const handler = mocks.handlers.get(AGENT_TOOL_CHANNELS.file); if (!handler) throw new Error("missing handler"); return handler({ sender: {} }, value); };
  return { read, invoke };
}

describe("chat file delivery", () => {
  it("opens the checked original path and leaves no extra file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "katarune-open-")); directories.push(dir);
    const original = join(dir, "report.txt");
    await writeFile(original, "report");
    const f = setup(original);
    mocks.open.mockResolvedValue("");
    expect(await f.invoke({ ...request, action: "open" })).toEqual({ filename: "report.txt", byteSize: 6 });
    expect(mocks.open).toHaveBeenCalledWith(original);
    expect(await readdir(dir)).toEqual(["report.txt"]);
    expect(await readFile(original, "utf8")).toBe("report");
    mocks.open.mockResolvedValue("No associated application");
    await expect(f.invoke({ ...request, action: "open" })).rejects.toThrow("无法打开文件");
  });
  it("keeps managed attachments in preview/save and never opens their storage path", async () => {
    const f = setup();
    await expect(f.invoke({ ...request, source: { attachmentId: request.characterId }, action: "open" })).rejects.toThrow("附件请使用预览或另存为");
    expect(f.read).not.toHaveBeenCalled();
    expect(mocks.open).not.toHaveBeenCalled();
  });
  it("previews text and saves the checked bytes to the user's chosen destination", async () => {
    const dir = await mkdtemp(join(tmpdir(), "katarune-delivery-")); directories.push(dir);
    const destination = join(dir, "saved.txt");
    const f = setup();
    expect(await f.invoke({ ...request, action: "preview" })).toEqual({ filename: "report.txt", byteSize: 6, text: "report" });
    mocks.save.mockResolvedValue({ canceled: false, filePath: destination });
    await f.invoke({ ...request, action: "save" });
    expect(await readFile(destination, "utf8")).toBe("report");
    expect(f.read).toHaveBeenCalledTimes(2);
    mocks.save.mockResolvedValue({ canceled: true });
    expect(await f.invoke({ ...request, action: "save" })).toMatchObject({ cancelled: true });
  });
  it("rejects malformed sources and denied reads before opening a viewer or save dialog", async () => {
    const f = setup();
    await expect(f.invoke({ ...request, source: { path: "report.txt", attachmentId: request.characterId }, action: "save" })).rejects.toThrow();
    expect(f.read).not.toHaveBeenCalled();
    f.read.mockRejectedValue(new Error("directory access revoked"));
    await expect(f.invoke({ ...request, action: "save" })).rejects.toThrow("revoked");
    await expect(f.invoke({ ...request, action: "open" })).rejects.toThrow("revoked");
    expect(mocks.save).not.toHaveBeenCalled(); expect(mocks.open).not.toHaveBeenCalled();
  });
});
