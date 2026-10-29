import { describe, it, expect } from "vitest";
import { Mp4Preview } from "../src/main/live/mp4Preview";
import { livePreviewSchema } from "../src/shared/live";

const box = (type: string, bytes = "synthetic") => {
  const result = Buffer.alloc(8 + bytes.length); result.writeUInt32BE(result.length); result.write(type, 4); result.write(bytes, 8); return result;
};
describe("fragmented live preview boundary", () => {
  it("preserves initialization and complete media across arbitrary pipe boundaries", () => {
    const output: { initialization: Uint8Array; fragment: Uint8Array }[] = [];
    const parser = new Mp4Preview((initialization, fragment) => output.push({ initialization, fragment }));
    const initialization = Buffer.concat([box("ftyp"), box("moov")]);
    const fragment = Buffer.concat([box("moof"), box("mdat")]);
    const input = Buffer.concat([initialization, fragment, fragment]);
    for (let offset = 0; offset < input.length; offset += 3) parser.write(input.subarray(offset, offset + 3));
    expect(output).toEqual([{ initialization, fragment }, { initialization, fragment }]);
    expect(livePreviewSchema.safeParse({ ...output[0], sequence: 1 }).success).toBe(true);
  });
  it("rejects unbounded or incomplete boxes instead of growing the preview queue", () => {
    const parser = new Mp4Preview(() => {});
    const oversized = Buffer.alloc(8); oversized.writeUInt32BE(32 * 1024 * 1024);
    expect(() => parser.write(oversized)).toThrow();
    expect(() => new Mp4Preview(() => {}).write(box("mdat"))).toThrow();
    expect(() => new Mp4Preview(() => {}).write(Buffer.concat([box("moof"), box("moof")]))).toThrow();
    expect(livePreviewSchema.safeParse({ initialization: new Uint8Array(), fragment: new Uint8Array(8), sequence: 0 }).success).toBe(false);
  });
});
