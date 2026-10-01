import { describe, expect, it } from "vitest";

import { normalizeThreadTitle } from "../src/renderer/src/chat/threadSidebarState";

describe("thread title normalization", () => {
  it("does not submit a blank rename", () => {
    expect(normalizeThreadTitle(" \n\t ")).toBeNull();
    expect(normalizeThreadTitle("  留在雨里的歌  ")).toBe("留在雨里的歌");
  });
});
