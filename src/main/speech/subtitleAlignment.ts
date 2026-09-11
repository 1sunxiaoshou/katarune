import { validateSpeechSegments, type SpeechSegment } from "../../shared/speechTiming";

// Alignment is only a boundary/time source. Every displayed character is sliced
// from the original spoken text; never substitute provider-normalized wording.
export function alignOriginalSubtitles(text: string, input: SpeechSegment[] | undefined, partial = false): SpeechSegment[] | undefined {
  const segments = validateSpeechSegments(input);
  if (!segments) return undefined;
  const normalize = (value: string) => value.normalize("NFKC").toLowerCase().replace(/[\p{P}\p{Z}\s]/gu, "");
  const units: { value: string; start: number }[] = [];
  let offset = 0;
  for (const character of text) {
    for (const value of normalize(character)) units.push({ value, start: offset });
    offset += character.length;
  }
  const normalized = segments.map(segment => Array.from(normalize(segment.text)));
  const aligned = normalized.flat().join("");
  const source = units.map(unit => unit.value).join("");
  if (!units.length || !aligned || (partial ? !source.startsWith(aligned) : aligned !== source)) return undefined;

  const result: SpeechSegment[] = [];
  let cursor = 0, sourceStart = 0;
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i]!;
    const length = normalized[i]!.length;
    if (!length) {
      if (result.length) result[result.length - 1]!.endSeconds = segment.endSeconds;
      continue;
    }
    cursor += length;
    // A normalization expansion (e.g. a ligature) cannot be split in the source.
    if (cursor < units.length && units[cursor]!.start === units[cursor - 1]!.start) return undefined;
    const sourceEnd = cursor < units.length ? units[cursor]!.start : text.length;
    const original = text.slice(sourceStart, sourceEnd);
    const previous = result[result.length - 1];
    // Keep an unspaced Latin word together rather than creating a word boundary.
    if (previous && /[A-Za-z0-9]$/.test(previous.text) && /^[A-Za-z0-9]/.test(original)) {
      previous.text += original;
      previous.endSeconds = segment.endSeconds;
    } else result.push({ text: original,
      startSeconds: result.length ? segment.startSeconds : segments[0]!.startSeconds,
      endSeconds: segment.endSeconds });
    sourceStart = sourceEnd;
  }
  return result.length && result.map(segment => segment.text).join("") === (partial ? text.slice(0, sourceStart) : text) ? result : undefined;
}
