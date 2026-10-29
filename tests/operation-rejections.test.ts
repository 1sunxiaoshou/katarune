import { beforeEach, describe, expect, it, vi } from "vitest";
import * as z from "zod/mini";
import type { IpcMainInvokeEvent } from "electron";
import { diagnosticIpcMain } from "../src/main/diagnostics/ipc";
import { diagnostic } from "../src/main/diagnostics/logger";
import { parseRequest } from "../src/main/diagnostics/operationRejected";

const handlers = vi.hoisted(() => new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>());
vi.mock("electron", () => ({ ipcMain: { handle: (name: string, listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown) => handlers.set(name, listener) } }));
vi.mock("../src/main/diagnostics/logger", async importOriginal => ({
  ...await importOriginal<typeof import("../src/main/diagnostics/logger")>(),
  diagnostic: vi.fn(() => "11111111-1111-4111-8111-111111111111"),
}));

beforeEach(() => { handlers.clear(); vi.mocked(diagnostic).mockClear(); });
const requestSchema = z.object({ enabled: z.boolean() });
const event = {} as IpcMainInvokeEvent;
function invoke(value: unknown) { return handlers.get("test:operation")!(event, value); }

describe("IPC operation outcomes", () => {
  it("rejects external input before business work, with a safe code and no incident", async () => {
    const work = vi.fn();
    diagnosticIpcMain.handle("test:operation", (_event, value: unknown) => {
      const request = parseRequest(requestSchema, value);
      work(request);
    });
    await expect(invoke({ enabled: "secret-input" })).rejects.toThrow("原因码：invalid-input");
    expect(work).not.toHaveBeenCalled();
    expect(diagnostic).toHaveBeenLastCalledWith("warn", "ipc.test.operation.rejected", expect.objectContaining({ outcome: "rejected", reasonCode: "invalid-input", operationId: expect.any(String) }));
    expect(JSON.stringify(vi.mocked(diagnostic).mock.calls)).not.toContain("secret-input");
    await invoke({ enabled: true });
    expect(work).toHaveBeenCalledWith({ enabled: true });
  });

  it("keeps internal schema failures and lookalike errors as real faults", async () => {
    for (const fail of [
      () => requestSchema.parse({ enabled: "corrupt-stored-value" }),
      () => { throw Object.assign(new Error("secret-fault"), { name: "OperationRejected", reasonCode: "invalid-input" }); },
      () => { throw Object.assign(new Error("secret-database"), { code: "SQLITE_CORRUPT" }); },
    ]) {
      diagnosticIpcMain.handle("test:operation", fail);
      await expect(invoke(null)).rejects.toThrow("故障编号：11111111-1111-4111-8111-111111111111");
      expect(diagnostic).toHaveBeenLastCalledWith("error", "ipc.test.operation.failed", expect.any(Object), expect.anything());
    }
  });

  it("keeps explicit cancellation out of WARN and ERROR", async () => {
    diagnosticIpcMain.handle("test:operation", () => { throw new DOMException("private", "AbortError"); });
    await expect(invoke(null)).rejects.toThrow("操作已取消。");
    expect(diagnostic).toHaveBeenLastCalledWith("info", "ipc.test.operation.cancelled", expect.any(Object), undefined);
  });
});
