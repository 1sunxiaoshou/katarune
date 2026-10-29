import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IpcMainEvent, IpcMainInvokeEvent } from "electron";
import { registerChatHandlers } from "../src/main/ipc/chatHandlers";
import { registerDiagnosticsHandlers } from "../src/main/diagnostics/handlers";
import { Diagnostics, diagnostic } from "../src/main/diagnostics/logger";
import { OperationRejected } from "../src/main/diagnostics/operationRejected";
import { DIAGNOSTICS_CHANNELS } from "../src/shared/diagnostics";
import { IPC_CHANNELS } from "../src/shared/ipc";

const fixture = vi.hoisted(() => ({
  on: new Map<string, (event: IpcMainEvent, value: unknown) => void>(),
  handle: new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>(),
}));
vi.mock("electron", () => ({
  ipcMain: {
    on: (channel: string, listener: (event: IpcMainEvent, value: unknown) => void) => fixture.on.set(channel, listener),
    handle: (channel: string, listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown) => fixture.handle.set(channel, listener),
  },
  app: { on: vi.fn() }, dialog: {}, shell: {}, nativeImage: {},
}));
vi.mock("../src/main/ai/chatService", () => ({ createChatService: () => ({}) }));
vi.mock("../src/main/diagnostics/logger", async importOriginal => ({
  ...await importOriginal<typeof import("../src/main/diagnostics/logger")>(),
  diagnostic: vi.fn(() => "11111111-1111-4111-8111-111111111111"),
}));

beforeEach(() => { fixture.on.clear(); fixture.handle.clear(); vi.mocked(diagnostic).mockClear(); });
function chat(fetchThread: () => unknown) {
  type Args = Parameters<typeof registerChatHandlers>;
  registerChatHandlers({ fetchThread } as unknown as Args[0], {} as Args[1], {} as Args[2], {} as Args[3]);
  const port = { start: vi.fn(), postMessage: vi.fn(), close: vi.fn() };
  const event = { sender: { id: 1 }, ports: [port] } as unknown as IpcMainEvent;
  const invoke = (value: unknown, input = event) => fixture.on.get(IPC_CHANNELS.startChatStream)!(input, value);
  return { port, event, invoke };
}
const request = {
  requestId: "11111111-1111-4111-8111-111111111111",
  characterId: "22222222-2222-4222-8222-222222222222",
  threadId: "test-thread", messages: [], frontendTools: {},
};

describe("non-invoke rejection boundaries", () => {
  it("records malformed chat requests without reading the database or retaining input", () => {
    const fetch = vi.fn(), { invoke, port, event } = chat(fetch);
    invoke({ secret: "private-input" });
    expect(fetch).not.toHaveBeenCalled();
    expect(port.close).toHaveBeenCalledOnce();
    expect(diagnostic).toHaveBeenLastCalledWith("warn", "chat.stream-rejected", { outcome: "rejected", reasonCode: "invalid-input" });
    event.ports.length = 0;
    invoke(request, event);
    expect(diagnostic).toHaveBeenLastCalledWith("warn", "chat.stream-rejected", { outcome: "rejected", reasonCode: "missing-port" });
    expect(JSON.stringify(vi.mocked(diagnostic).mock.calls)).not.toContain("private-input");
  });

  it("distinguishes missing/read-only conversations from database faults", () => {
    for (const entry of [
      { fetch: () => { throw new OperationRejected("resource-unavailable"); }, code: "resource-unavailable" },
      { fetch: () => ({ kind: "live" }), code: "operation-not-allowed" },
    ]) {
      const { invoke, port } = chat(entry.fetch);
      invoke(request);
      expect(diagnostic).toHaveBeenLastCalledWith("warn", "chat.stream-rejected", { outcome: "rejected", reasonCode: entry.code });
      expect(port.close).toHaveBeenCalledOnce();
      expect(port.postMessage.mock.calls[0]?.[0].message).toContain(`原因码：${entry.code}`);
    }
    const fault = Object.assign(new Error("private database details"), { code: "SQLITE_CORRUPT" });
    const { invoke, port } = chat(() => { throw fault; });
    invoke(request);
    expect(diagnostic).toHaveBeenLastCalledWith("error", "chat.stream-failed", { outcome: "failed" }, fault);
    expect(port.postMessage.mock.calls[0]?.[0].message).toContain("故障编号：");
    expect(JSON.stringify(port.postMessage.mock.calls)).not.toContain("private database details");
    expect(port.close).toHaveBeenCalledOnce();
  });

  it("audits untrusted diagnostic senders with bounded warning aggregation", async () => {
    const logger = new Diagnostics("unused-test-directory", "test");
    registerDiagnosticsHandlers(logger);
    const event = { sender: {}, senderFrame: {} } as IpcMainEvent;
    for (let i = 0; i < 1000; i++) fixture.on.get(DIAGNOSTICS_CHANNELS.report)!(event, { token: "private-token" });
    expect(logger.memorySnapshot()).toHaveLength(1);
    expect(JSON.parse(logger.memorySnapshot()[0]!)).toMatchObject({ event: "diagnostics.report.rejected", level: "warn", reasonCode: "forbidden-source" });
    expect(logger.memorySnapshot().join()).not.toContain("private-token");
    await expect(fixture.handle.get(DIAGNOSTICS_CHANNELS.open)!(event as IpcMainInvokeEvent)).resolves.toEqual({ status: "error" });
  });
});
