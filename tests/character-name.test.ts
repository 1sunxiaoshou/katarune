import { describe, expect, it } from "vitest";
import { getCharacterNameReading } from "../src/renderer/src/characters/characterName";

describe("character name reading", () => {
  it("uses surname pronunciation for Chinese names", () => {
    expect(getCharacterNameReading("单田芳")).toEqual({
      kind: "pinyin",
      text: "Shan Tian Fang",
    });
  });

  it("transliterates Han characters while preserving Latin text", () => {
    expect(getCharacterNameReading("中文 Alice")).toEqual({
      kind: "pinyin",
      text: "Zhong Wen Alice",
    });
  });
});
