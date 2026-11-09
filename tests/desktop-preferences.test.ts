import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { writeDesktopPreferences } from "../src/main/avatar/desktopPreferences";

vi.mock("node:fs/promises", async original => {
  const fs = await original<typeof import("node:fs/promises")>();
  return { ...fs, rename: vi.fn(fs.rename) };
});
const realFs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
let directory: string;
beforeEach(async () => {
  vi.mocked(rename).mockReset().mockImplementation(realFs.rename);
  directory = await mkdtemp(join(tmpdir(), "katarune-desktop-preferences-"));
});
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

describe("desktop preference replacement", () => {
  it("recovers from temporary Windows sharing locks without losing the previous file", async () => {
    const file = join(directory, "layout.json");
    await writeFile(file, "previous");
    vi.mocked(rename).mockRejectedValueOnce(Object.assign(new Error("busy"), { code: "EPERM" }))
      .mockRejectedValueOnce(Object.assign(new Error("busy"), { code: "EBUSY" }));
    await writeDesktopPreferences(file, "latest");
    expect(await readFile(file, "utf8")).toBe("latest");
    expect(await readdir(directory)).toEqual(["layout.json"]);
  });

  it("keeps the previous file and propagates permanent errors", async () => {
    const file = join(directory, "layout.json");
    await writeFile(file, "previous");
    const error = Object.assign(new Error("I/O failure"), { code: "EIO" });
    vi.mocked(rename).mockRejectedValue(error);
    await expect(writeDesktopPreferences(file, "latest")).rejects.toBe(error);
    expect(rename).toHaveBeenCalledTimes(1);
    expect(await readFile(file, "utf8")).toBe("previous");
    expect(await readdir(directory)).toEqual(["layout.json"]);
  });

  it("bounds lock retries and preserves data when the lock does not clear", async () => {
    const file = join(directory, "layout.json");
    await writeFile(file, "previous");
    const error = Object.assign(new Error("still locked"), { code: "EPERM" });
    vi.mocked(rename).mockRejectedValue(error);
    await expect(writeDesktopPreferences(file, "latest")).rejects.toBe(error);
    expect(rename).toHaveBeenCalledTimes(6);
    expect(await readFile(file, "utf8")).toBe("previous");
    expect(await readdir(directory)).toEqual(["layout.json"]);
  });
});
