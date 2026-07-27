import { describe, expect, it } from "vitest";

import {
  normalizeThreadTitle,
  readThreadListCollapsed,
  THREAD_LIST_COLLAPSED_STORAGE_KEY,
  writeThreadListCollapsed,
} from "../src/renderer/src/chat/threadSidebarState";
import { formatThreadTime } from "../src/renderer/src/chat/threadTime";

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

describe("thread sidebar time", () => {
  const now = new Date(2026, 6, 24, 14, 30, 0);

  it("formats recent and same-day threads", () => {
    expect(formatThreadTime(new Date(2026, 6, 24, 14, 29, 30), now)).toBe(
      "刚刚",
    );
    expect(formatThreadTime(new Date(2026, 6, 24, 9, 5, 0), now)).toBe(
      "今天 09:05",
    );
  });

  it("formats this week, this year, and prior years", () => {
    expect(formatThreadTime(new Date(2026, 6, 21, 9, 0, 0), now)).toMatch(
      /^星期/,
    );
    expect(formatThreadTime(new Date(2026, 5, 3, 9, 0, 0), now)).toBe(
      "6 月 3 日",
    );
    expect(formatThreadTime(new Date(2025, 11, 31, 9, 0, 0), now)).toBe(
      "2025 年 12 月 31 日",
    );
  });
});

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
