import { readFile } from "node:fs/promises";
import { join } from "node:path";
import * as z from "zod/mini";

const profileSchema = z.object({
  mfccNum: z.literal(12),
  useStandardization: z.boolean(),
  compareMethod: z.number().check(z.int(), z.gte(0), z.lte(2)),
  mfccDataCount: z.number().check(z.int(), z.gte(1), z.lte(256)),
  melFilterBankChannels: z.number().check(z.int(), z.gte(12), z.lte(128)),
  targetSampleRate: z.number().check(z.int(), z.gte(8000), z.lte(48000)),
  sampleCount: z.number().check(z.int(), z.gte(256), z.lte(8192)),
  mfccs: z.array(z.object({ name: z.string(), mfccCalibrationDataList: z.array(z.object({
    array: z.array(z.number()).check(z.length(12)),
  })).check(z.minLength(1), z.maxLength(256)) })).check(z.minLength(5), z.maxLength(32)),
});

export async function resolveSpeechProfile(directory: string | undefined, voiceKey: string): Promise<string | undefined> {
  if (!directory || !/^[a-f0-9]{64}$/.test(voiceKey)) return undefined;
  const path = join(directory, `${voiceKey}.json`);
  try {
    const json = await readFile(path, "utf8");
    if (json.length > 2 * 1024 * 1024) return undefined;
    const value = profileSchema.parse(JSON.parse(json));
    if ((value.sampleCount & (value.sampleCount - 1)) !== 0) return undefined;
    if (!["A", "I", "U", "E", "O"].every(name => value.mfccs.some(mfcc => mfcc.name === name))) return undefined;
    if (value.useStandardization) {
      const rows = value.mfccs.flatMap(mfcc => mfcc.mfccCalibrationDataList);
      for (let i = 0; i < 12; i++) {
        const mean = rows.reduce((sum, row) => sum + row.array[i]!, 0) / rows.length;
        if (rows.reduce((sum, row) => sum + (row.array[i]! - mean) ** 2, 0) < 1e-12) return undefined;
      }
    }
    return path;
  } catch { return undefined; }
}
