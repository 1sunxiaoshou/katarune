// Validate complete RIFF/WAVE PCM or float audio before handing it to Unity.
export function normalizeFishStreamingWav(audio: Uint8Array): Uint8Array {
  const data = Buffer.from(audio);
  // Fish timestamp WAV observed on s2.1-pro-free uses Python wave's streaming
  // placeholder (data=0xffffff00, RIFF=data+36). Do not repair arbitrary truncation.
  if (data.length >= 44 && data.toString("ascii", 0, 4) === "RIFF"
      && data.toString("ascii", 8, 12) === "WAVE" && data.toString("ascii", 36, 40) === "data"
      && data.readUInt32LE(4) === 0xffffff24 && data.readUInt32LE(40) === 0xffffff00) {
    data.writeUInt32LE(data.length - 8, 4);
    data.writeUInt32LE(data.length - 44, 40);
  }
  return new Uint8Array(data);
}

export function wavDuration(audio: Uint8Array): number {
  const data = Buffer.from(audio.buffer, audio.byteOffset, audio.byteLength);
  if (data.length < 44 || data.toString("ascii", 0, 4) !== "RIFF" || data.toString("ascii", 8, 12) !== "WAVE")
    throw new Error("Invalid WAV header.");
  const declared = data.readUInt32LE(4);
  if (declared !== 0 && declared !== 0xffffffff && declared + 8 > data.length) throw new Error(`Truncated WAV (declared=${declared}, actual=${data.length}).`);
  let byteRate = 0;
  let align = 0;
  let bytes = 0;
  for (let offset = 12; offset + 8 <= data.length;) {
    const name = data.toString("ascii", offset, offset + 4);
    let size = data.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (name === "data" && (size === 0xffffffff || size === 0)) size = data.length - start;
    if (start + size > data.length) throw new Error("Truncated WAV chunk.");
    if (name === "fmt ") {
      if (size < 16 || ![1, 3].includes(data.readUInt16LE(start))) throw new Error("Unsupported WAV format.");
      byteRate = data.readUInt32LE(start + 8);
      align = data.readUInt16LE(start + 12);
    }
    if (name === "data") bytes += size;
    offset = start + size + (size % 2);
  }
  if (!byteRate || !align || !bytes || bytes % align !== 0) throw new Error("Invalid WAV samples.");
  return bytes / byteRate;
}
