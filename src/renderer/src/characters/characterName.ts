import { pinyin } from "pinyin-pro";

const HAN_CHARACTER = /\p{Script=Han}/u;
const LATIN_CHARACTER = /\p{Script=Latin}/u;

export type CharacterNameReadingKind = "pinyin" | "latin" | "other";

export interface CharacterNameReading {
  readonly kind: CharacterNameReadingKind;
  readonly text: string;
}

export function getCharacterNameReading(name: string): CharacterNameReading {
  const normalized = name.trim().replace(/\s+/g, " ");

  if (HAN_CHARACTER.test(normalized)) {
    return {
      kind: "pinyin",
      text: pinyin(normalized, {
        mode: "surname",
        nonZh: "consecutive",
        toneType: "none",
      })
        .replace(/\s+/g, " ")
        .trim()
        .replace(
          /(^|[\s·-])(\p{L})/gu,
          (_, separator: string, letter: string) =>
            `${separator}${letter.toLocaleUpperCase("zh-CN")}`,
        ),
    };
  }

  if (LATIN_CHARACTER.test(normalized)) {
    return { kind: "latin", text: normalized };
  }

  return { kind: "other", text: normalized };
}
