import { describe, expect, it } from "vitest";

import {
  normalizeThreadTitle,
  readThreadListCollapsed,
  THREAD_LIST_COLLAPSED_STORAGE_KEY,
  writeThreadListCollapsed,
} from "../src/renderer/src/chat/threadSidebarState";

function memoryStorage(initialValue: string | null = null): {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
} {
  let value = initialValue;
  return {
    getItem: (key) =>
      key === THREAD_LIST_COLLAPSED_STORAGE_KEY ? value : null,
    setItem: (key, nextValue) => {
      if (key === THREAD_LIST_COLLAPSED_STORAGE_KEY) value = nextValue;
    },
  };
}

describe("thread sidebar preference", () => {
  it("defaults to expanded and persists both states", () => {
    const storage = memoryStorage();
    expect(readThreadListCollapsed(storage)).toBe(false);

    writeThreadListCollapsed(storage, true);
    expect(readThreadListCollapsed(storage)).toBe(true);

    writeThreadListCollapsed(storage, false);
    expect(readThreadListCollapsed(storage)).toBe(false);
  });

  it("does not submit a blank rename", () => {
    expect(normalizeThreadTitle(" \n\t ")).toBeNull();
    expect(normalizeThreadTitle("  留在雨里的歌  ")).toBe("留在雨里的歌");
  });
});
