import { MAX_LIVE_PREVIEW_BYTES } from "../../shared/live";

// Only frames top-level ISO BMFF boxes from our pinned FFmpeg muxer. Decoding,
// track timing and A/V synchronization belong to Chromium's MediaSource.
export class Mp4Preview {
  private pending = Buffer.alloc(0);
  private initialization = Buffer.alloc(0);
  private movieFragment: Buffer | undefined;
  constructor(private readonly emit: (initialization: Uint8Array<ArrayBuffer>, fragment: Uint8Array<ArrayBuffer>) => void) {}

  write(bytes: Buffer) {
    this.pending = Buffer.concat([this.pending, bytes]);
    while (this.pending.length >= 8) {
      const length = this.pending.readUInt32BE(0);
      if (length < 8 || length > MAX_LIVE_PREVIEW_BYTES) throw new Error("直播预览媒体块无效。");
      if (this.pending.length < length) return;
      const box = this.pending.subarray(0, length);
      const type = box.toString("ascii", 4, 8);
      this.pending = this.pending.subarray(length);
      if (type === "ftyp") this.initialization = Buffer.from(box);
      else if (type === "moov") {
        if (this.initialization.length + length > 1024 * 1024) throw new Error("直播预览初始化过大。");
        this.initialization = Buffer.concat([this.initialization, box]);
      } else if (type === "moof") {
        if (this.movieFragment) throw new Error("直播预览缺少媒体数据。");
        this.movieFragment = Buffer.from(box);
      } else if (type === "mdat") {
        if (!this.initialization.length || !this.movieFragment || this.movieFragment.length + length > MAX_LIVE_PREVIEW_BYTES) throw new Error("直播预览分段无效。");
        this.emit(this.initialization, Buffer.concat([this.movieFragment, box]));
        this.movieFragment = undefined;
      }
    }
  }
}
