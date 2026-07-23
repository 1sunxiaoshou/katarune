import { describe, expect, it } from "vitest";
import { getCharacterNameReading } from "../src/renderer/src/characters/characterName";

describe("character name reading", () => {
  it("renders Chinese names as toneless pinyin", () => {
    expect(getCharacterNameReading("星澜")).toEqual({
      kind: "pinyin",
      text: "Xing Lan",
    });
  });

  it("uses surname pronunciation for Chinese names", () => {
    expect(getCharacterNameReading("单田芳")).toEqual({
      kind: "pinyin",
      text: "Shan Tian Fang",
    });
  });

  it("preserves Latin names for the alternate presentation", () => {
    expect(getCharacterNameReading("  Alice Snow  ")).toEqual({
      kind: "latin",
      text: "Alice Snow",
    });
  });

  it("transliterates Han characters while preserving Latin text", () => {
    expect(getCharacterNameReading("星澜 Alice")).toEqual({
      kind: "pinyin",
      text: "Xing Lan Alice",
    });
  });
});
