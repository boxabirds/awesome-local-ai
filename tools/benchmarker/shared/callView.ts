// What a call page says about a call's tokens. The record holds a call's output tokens as one figure; thinking, visible text and
// tool arguments are not counted apart, so each part's tokens are the total shared out by the characters it holds. A figure
// made that way is marked "≈" on the page, and the parts always add up to the total.

export interface PartChars { thinking: number; text: number; tools: number }
export interface PartTokens { thinking: number; text: number; tools: number }

/** The output tokens of a call shared out by characters, rounded by the largest remainder so the parts sum to `outTok`.
 * Null when no token count was recorded, or when the call has no characters to share by. */
export function outputSplit(outTok: number | null, chars: PartChars): PartTokens | null {
  const total = chars.thinking + chars.text + chars.tools;
  if (outTok === null || total === 0) return null;
  const keys = ["thinking", "text", "tools"] as const;
  const exact = keys.map((k) => (outTok * chars[k]) / total);
  const floors = exact.map(Math.floor);
  let left = outTok - floors.reduce((a, b) => a + b, 0);
  const byRemainder = exact.map((x, i) => [x - Math.floor(x), i] as const).toSorted((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (const [, i] of byRemainder) {
    if (left <= 0) break;
    if (chars[keys[i]] > 0) { floors[i] += 1; left -= 1; }
  }
  return { thinking: floors[0], text: floors[1], tools: floors[2] };
}
