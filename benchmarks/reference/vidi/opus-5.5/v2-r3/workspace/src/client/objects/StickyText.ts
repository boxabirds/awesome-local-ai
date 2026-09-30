// Pure-ish text logic for sticky notes: length clamp, minimal Y.Text diff,
// counter visibility and font fitting. The clamp and diff live in
// src/shared/text-edit.ts (shared with story 9 text) and are re-exported here.
import { applyTextDiff, clampToLimit as clampText, diffText } from '../../shared/text-edit';
import {
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_TEXT_MAX_CHARS,
} from '../../shared/config';

/** Keeps at most `max` UTF-16 code units, never splitting a surrogate pair. */
export function clampToLimit(next: string, max: number = STICKY_TEXT_MAX_CHARS): string {
  return clampText(next, max);
}

export { applyTextDiff, diffText };

/** True when the remaining characters are within the counter threshold. */
export function counterVisible(length: number): boolean {
  return STICKY_TEXT_MAX_CHARS - length <= STICKY_COUNTER_THRESHOLD_CHARS;
}

/**
 * Finds the largest integer font size in [STICKY_FONT_MIN_PX, STICKY_FONT_MAX_PX]
 * at which `el`'s content fits in `box` (scrollHeight <= box). Sizes are in
 * board units, so the result is independent of zoom. Leaves the chosen size
 * applied to `el`.
 */
export function fitFontSize(el: HTMLElement, box: number): { fontPx: number; overflow: boolean } {
  const fits = (px: number) => {
    el.style.fontSize = `${px}px`;
    return el.scrollHeight <= box;
  };
  if (fits(STICKY_FONT_MAX_PX)) return { fontPx: STICKY_FONT_MAX_PX, overflow: false };
  if (!fits(STICKY_FONT_MIN_PX)) return { fontPx: STICKY_FONT_MIN_PX, overflow: true };
  let lo = STICKY_FONT_MIN_PX; // fits
  let hi = STICKY_FONT_MAX_PX; // does not fit
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (fits(mid)) lo = mid;
    else hi = mid;
  }
  el.style.fontSize = `${lo}px`;
  return { fontPx: lo, overflow: false };
}

/**
 * Applies the text limit to an edit from `prev` to `next`. Only the newly
 * inserted characters that would go beyond `max` are dropped (so typing in the
 * middle of a full note never pushes text off its end); the caret goes to the
 * end of the kept insertion. When `prev` is itself over the limit, falls back
 * to `clampToLimit`.
 */
export function limitEdit(
  prev: string,
  next: string,
  max: number = STICKY_TEXT_MAX_CHARS,
): { text: string; caret: number } | null {
  if (next.length <= max) return null;
  if (prev.length > max) {
    const text = clampToLimit(next, max);
    return { text, caret: text.length };
  }
  const minLen = Math.min(prev.length, next.length);
  let start = 0;
  while (start < minLen && prev.charCodeAt(start) === next.charCodeAt(start)) start++;
  let suffix = 0;
  while (
    suffix < minLen - start &&
    prev.charCodeAt(prev.length - 1 - suffix) === next.charCodeAt(next.length - 1 - suffix)
  ) {
    suffix++;
  }
  const kept = start + suffix; // characters of prev that survive the edit
  const inserted = next.slice(start, next.length - suffix);
  const allowed = clampToLimit(inserted, Math.max(0, max - kept));
  const text = next.slice(0, start) + allowed + next.slice(next.length - suffix);
  return { text, caret: start + allowed.length };
}

/** One entry of a Y.Text change delta. */
export type TextDelta = { retain?: number; insert?: unknown; delete?: number };

/**
 * Maps an index in the text before a change to the text after it (story 3:
 * keeping the caret in place while someone else types). An insert exactly at
 * `index` stays after the index unless `stickRight` (then the index moves past it).
 */
export function transformIndex(index: number, delta: readonly TextDelta[], stickRight = false): number {
  let oldPos = 0; // position in the old text
  let shift = 0;
  for (const op of delta) {
    if (op.retain !== undefined) {
      oldPos += op.retain;
      if (oldPos > index) break;
    } else if (op.insert !== undefined) {
      const len = typeof op.insert === 'string' ? op.insert.length : 1;
      if (oldPos < index || (oldPos === index && stickRight)) shift += len;
      else break;
    } else if (op.delete !== undefined) {
      const end = oldPos + op.delete;
      if (end <= index) shift -= op.delete;
      else if (oldPos < index) shift -= index - oldPos;
      else break;
      oldPos = end;
    }
  }
  return index + shift;
}
