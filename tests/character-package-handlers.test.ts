import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerCharacterPackageHandlers } from "../src/main/ipc/characterPackageHandlers";
import { PACKAGE_CHANNELS } from "../src/shared/characterPackages";
import type { CharacterPackageService } from "../src/main/characters/characterPackageService";
import type { AvatarService } from "../src/main/avatar/avatarService";
import type { DatabaseRuntime } from "../src/main/database/database";
const fixture = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(),
  picker: vi.fn(),
}));
vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: any[]) => any) =>
      fixture.handlers.set(channel, handler),
  },
  BrowserWindow: { fromWebContents: () => null },
  dialog: { showOpenDialog: fixture.picker },
}));
const characterId = "11111111-1111-4111-8111-111111111111",
  packageId = "22222222-2222-4222-8222-222222222222",
  requestId = "33333333-3333-4333-8333-333333333333";
beforeEach(() => {
  fixture.handlers.clear();
  fixture.picker.mockReset();
});
function setup() {
  const release = vi.fn(),
    service = {
      runtime: vi.fn((id) => ({ id })),
      retain: vi.fn(() => release),
      cancel: vi.fn(),
      import: vi.fn(),
      list: vi.fn(),
      detail: vi.fn(),
      remove: vi.fn(),
    };
  const db = {
    fetchCharacter: vi.fn(() => ({ packageId: "builtin:default" })),
    bindCharacterPackage: vi.fn(),
  };
  const avatar = { switchPackage: vi.fn(async () => {}) };
  registerCharacterPackageHandlers(
    service as unknown as CharacterPackageService,
    db as unknown as DatabaseRuntime,
    avatar as unknown as AvatarService,
  );
  const sender = Object.assign(new EventEmitter(), {
      id: 7,
      isDestroyed: () => false,
      send: vi.fn(),
    }),
    event = { sender };
  return {
    service,
    db,
    avatar,
    release,
    event,
    invoke: (channel: string, value: unknown) =>
      fixture.handlers.get(channel)!(event, value),
  };
}
describe("character package IPC transactions", () => {
  it("saves only after Unity accepts and releases both resource leases", async () => {
    const { invoke, avatar, db, release } = setup();
    await invoke(PACKAGE_CHANNELS.bind, { characterId, packageId });
    expect(avatar.switchPackage).toHaveBeenCalledWith(characterId, {
      id: packageId,
    });
    expect(db.bindCharacterPackage.mock.invocationCallOrder[0]).toBeGreaterThan(
      avatar.switchPackage.mock.invocationCallOrder[0]!,
    );
    expect(release).toHaveBeenCalledTimes(2);
  });
  it("does not persist a rejected Unity candidate", async () => {
    const { invoke, avatar, db, release } = setup();
    avatar.switchPackage.mockRejectedValueOnce(new Error("bad model"));
    await expect(
      invoke(PACKAGE_CHANNELS.bind, { characterId, packageId }),
    ).rejects.toThrow("bad model");
    expect(db.bindCharacterPackage).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledTimes(2);
  });
  it("restores the previous package when saving the binding fails", async () => {
    const { invoke, avatar, db, release } = setup();
    db.bindCharacterPackage.mockImplementationOnce(() => {
      throw new Error("disk full");
    });
    await expect(
      invoke(PACKAGE_CHANNELS.bind, { characterId, packageId }),
    ).rejects.toThrow("disk full");
    expect(avatar.switchPackage).toHaveBeenNthCalledWith(2, characterId, {
      id: "builtin:default",
    });
    expect(release).toHaveBeenCalledTimes(2);
  });
  it("cancels even while the file picker is still open", async () => {
    const { invoke, service } = setup();
    let select!: (value: unknown) => void;
    fixture.picker.mockReturnValue(
      new Promise((resolve) => {
        select = resolve;
      }),
    );
    const pending = invoke(PACKAGE_CHANNELS.import, { requestId });
    await invoke(PACKAGE_CHANNELS.cancel, { requestId });
    select({ canceled: false, filePaths: ["pack.zip"] });
    expect(await pending).toEqual({ canceled: true, package: null });
    expect(service.import).not.toHaveBeenCalled();
  });
  it("ignores cancellation from a different window and cancels a destroyed sender", async () => {
    const { invoke, service, event } = setup();
    let select!: (value: unknown) => void;
    fixture.picker.mockReturnValue(
      new Promise((resolve) => {
        select = resolve;
      }),
    );
    const pending = invoke(PACKAGE_CHANNELS.import, { requestId });
    fixture.handlers.get(PACKAGE_CHANNELS.cancel)!(
      { sender: { id: 8 } },
      { requestId },
    );
    expect(service.cancel).not.toHaveBeenCalled();
    event.sender.emit("destroyed");
    select({ canceled: false, filePaths: ["pack.zip"] });
    expect(await pending).toEqual({ canceled: true, package: null });
    expect(service.cancel).toHaveBeenCalledWith(requestId);
  });
});
