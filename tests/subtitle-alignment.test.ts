import { expect, it } from "vitest";
import { alignOriginalSubtitles } from "../src/main/speech/subtitleAlignment";
const segments = (...texts: string[]) => texts.map((text, i) => ({ text, startSeconds: i, endSeconds: i + .8 }));

it("preserves original punctuation and line breaks while retaining supplier times", () => {
  const text = '老师，现在一点二十了哦——这可不叫“晚上”了。\n睡不着？';
  const result = alignOriginalSubtitles(text, segments("老师", "现在一点二十了哦", "这可不叫晚上了", "睡不着"));
  expect(result?.map(s => s.text).join("")).toBe(text);
  expect(result?.[0]).toEqual({ text: "老师，", startSeconds: 0, endSeconds: .8 });
  expect(result?.[3]?.text).toBe("睡不着？");
});
it("retains case, spacing and unsplit English words", () => {
  expect(alignOriginalSubtitles("Hello, WORLD!", segments("he", "llo", "world"))?.map(s => s.text))
    .toEqual(["Hello, ", "WORLD!"]);
});
it("does not substitute normalized numbers or unmatched wording", () => {
  expect(alignOriginalSubtitles("12点。", segments("十二点"))).toBeUndefined();
  expect(alignOriginalSubtitles("原文。", segments("改写"))).toBeUndefined();
});
it("matches repeated phrases sequentially without losing separators", () => {
  const result = alignOriginalSubtitles("你好，你好！", segments("你好", "你好"));
  expect(result?.map(s => s.text)).toEqual(["你好，", "你好！"]);
  expect(result?.map(s => s.startSeconds)).toEqual([0, 1]);
});
it("handles punctuation-only supplier fragments without displaying replacements", () => {
  const result = alignOriginalSubtitles("你好！", segments("你好", "."));
  expect(result).toEqual([{ text: "你好！", startSeconds: 0, endSeconds: 1.8 }]);
});
