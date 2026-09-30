/**
 * Sticky note text helpers (story 2): length clamp, minimal Y.Text diff,
 * counter visibility and font auto-fit. Pure logic lives here so it can be
 * unit-tested without a DOM layout engine.
 */
import type * as Y from 'yjs';
import {
  STICKY_TEXT_MAX_CHARS,
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
} from '../../shared/config';

/** Padding between a note's edge and its text, in board units. */
export const NOTE_TEXT_INSET = 12;

/**
 * Keeps at most `max` characters. A surrogate pair that would straddle the
 * limit is dropped whole, so the kept text never contains a lone surrogate.
 */
export function clampToLimit(next: string, max: number = STICKY_TEXT_MAX_CHARS): string {
  if (next.length <= max) return next;
  let kept = '';
  for (const char of next) {
    if (kept.length + char.length > max) break;
    kept += char;
  }
  return kept;
}

/**
 * Writes `next` into `ytext` using the minimal change (common prefix and
 * suffix), so a concurrent typist (story 3) is never overwritten by a full
 * replace. Yjs indexes UTF-16 code units, so the diff runs over code points and
 * the boundaries are converted back to code-unit offsets.
 */
export function applyTextDiff(ytext: Y.Text, next: string, origin: unknown): void {
  const currentCps = Array.from(ytext.toString());
  const nextCps = Array.from(next);

  let start = 0;
  while (
    start < currentCps.length &&
    start < nextCps.length &&
    currentCps[start] === nextCps[start]
  ) {
    start += 1;
  }

  let currentEnd = currentCps.length;
  let nextEnd = nextCps.length;
  while (
    currentEnd > start &&
    nextEnd > start &&
    currentCps[currentEnd - 1] === nextCps[nextEnd - 1]
  ) {
    currentEnd -= 1;
    nextEnd -= 1;
  }

  const deleteFrom = unitOffset(currentCps, start);
  const deleteTo = unitOffset(currentCps, currentEnd);
  const deleteCount = deleteTo - deleteFrom;
  const insertText = nextCps.slice(start, nextEnd).join('');

  if (deleteCount === 0 && insertText === '') return;

  const apply = () => {
    if (deleteCount > 0) ytext.delete(deleteFrom, deleteCount);
    if (insertText !== '') ytext.insert(deleteFrom, insertText);
  };

  if (ytext.doc) ytext.doc.transact(apply, origin);
  else apply();
}

/** UTF-16 offset of the code point at `index`. */
function unitOffset(cps: string[], index: number): number {
  let offset = 0;
  for (let i = 0; i < index; i += 1) offset += cps[i].length;
  return offset;
}

/** True when the remaining budget is small enough to show the counter. */
export function counterVisible(length: number): boolean {
  return STICKY_TEXT_MAX_CHARS - length <= STICKY_COUNTER_THRESHOLD_CHARS;
}

/**
 * Largest integer font size in [STICKY_FONT_MIN_PX, STICKY_FONT_MAX_PX] at
 * which the element's content still fits a box of `box` pixels. When even the
 * minimum size does not fit, `overflow` is true (the caller clips and fades the
 * bottom edge). Leaves the element styled with the returned size.
 */
export function fitFontSize(
  el: HTMLElement,
  box: number,
): { fontPx: number; overflow: boolean } {
  const fits = (px: number): boolean => {
    el.style.fontSize = `${px}px`;
    return el.scrollHeight <= box;
  };

  if (!fits(STICKY_FONT_MIN_PX)) return { fontPx: STICKY_FONT_MIN_PX, overflow: true };
  if (fits(STICKY_FONT_MAX_PX)) return { fontPx: STICKY_FONT_MAX_PX, overflow: false };

  let lo = STICKY_FONT_MIN_PX; // fits
  let hi = STICKY_FONT_MAX_PX; // does not fit
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (fits(mid)) lo = mid;
    else hi = mid;
  }
  el.style.fontSize = `${lo}px`;
  return { fontPx: lo, overflow: false };
}
