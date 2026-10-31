import { createHash, randomBytes } from "node:crypto";

// Webcast signature wire format: a 12-byte envelope, single-byte RC4 key,
// double-MD5 tail, counter, salt and XOR checksum; custom base64 alphabet.
// Protocol references: dart_simple_live xbogus and DouyinLiveRecorder _xbogus.
// No browser SDK, generated JavaScript, or external signing service is executed.
const ALPHABET = "Dkdpgh4ZKsQB80/Mfvw36XI1R25+WUAlEi7NLboqYTOPuzmFjJnryx9HVGcaStCe";
export const DOUYIN_SDK_VERSION = "1.0.14-beta.0";

export function douyinStub(roomId: string, deviceId: string): string {
  if (!/^\d{1,32}$/.test(roomId) || !/^\d{1,32}$/.test(deviceId)) throw new Error("Invalid webcast identifiers");
  const entries = { live_id: "1", aid: "6383", version_code: "180800", webcast_sdk_version: DOUYIN_SDK_VERSION,
    room_id: roomId, sub_room_id: "", sub_channel_id: "", did_rule: "3", user_unique_id: deviceId,
    device_platform: "web", device_type: "", ac: "", identity: "audience" };
  return createHash("md5").update(Object.entries(entries).map(([key, value]) => `${key}=${value}`).join(",")).digest("hex");
}
export function signDouyinStub(stub: string, entropy: Uint8Array = randomBytes(2)): string {
  if (!/^[a-f0-9]{32}$/i.test(stub) || entropy.length !== 2) throw new Error("Invalid webcast signature input");
  const digest = createHash("md5").update(Buffer.from(stub, "hex")).digest();
  const key = entropy[0]!, salt = entropy[1]!;
  const clear = Buffer.from([1, 0, 1, 14, 69, 63, digest[14]!, digest[15]!, salt, 0]);
  clear[9] = clear.subarray(0, 9).reduce((result, byte) => result ^ byte, 0);
  const box = Array.from({ length: 256 }, (_, index) => index);
  let cursor = 0;
  for (let index = 0; index < 256; index++) {
    cursor = (cursor + box[index]! + key) & 255;
    [box[index], box[cursor]] = [box[cursor]!, box[index]!];
  }
  let left = 0; cursor = 0;
  const encrypted = clear.map(byte => {
    left = (left + 1) & 255; cursor = (cursor + box[left]!) & 255;
    [box[left], box[cursor]] = [box[cursor]!, box[left]!];
    return byte ^ box[(box[left]! + box[cursor]!) & 255]!;
  });
  return Buffer.concat([Buffer.from([64, key]), encrypted]).toString("base64")
    .replace(/[A-Za-z0-9+/]/g, char => ALPHABET["ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/".indexOf(char)]!);
}
export const signDouyin = (roomId: string, deviceId: string) => signDouyinStub(douyinStub(roomId, deviceId));
