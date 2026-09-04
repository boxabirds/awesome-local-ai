/** Shared input hygiene for anything a player can type. */

/** C0 and C1 control characters, stripped so names cannot smuggle escapes. */
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/g;

export function cleanText(value: unknown, maxLength: number): string {
  return String(value ?? "")
    .replace(CONTROL_CHARS, "")
    .trim()
    .slice(0, maxLength);
}
