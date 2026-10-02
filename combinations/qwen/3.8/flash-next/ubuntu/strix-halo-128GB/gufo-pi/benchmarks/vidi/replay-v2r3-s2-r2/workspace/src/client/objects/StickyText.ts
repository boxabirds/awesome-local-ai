import type * as Y from 'yjs';
import {
  STICKY_TEXT_MAX_CHARS,
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
} from '../../shared/config';

/** Keep at most `max` characters; characters beyond the limit are dropped. */
export function clampToLimit(next: string, max: number = STICKY_TEXT_MAX_CHARS): string {
  return next.length <= max ? next : next.slice(0, max);
}

/** The counter appears once the remaining characters are within the threshold. */
export function counterVisible(length: number): boolean {
  const remaining = STICKY_TEXT_MAX_CHARS - length;
  return remaining <= STICKY_COUNTER_THRESHOLD_CHARS;
}

/**
 * Apply `next` to a Y.Text with the minimal change (common prefix + common
 * suffix), so concurrent typing by others (story 3) is never destroyed. Works
 * in code points so emoji surrogate pairs are never split. Opens one
 * transaction tagged with `origin`; does nothing (no transaction) when equal.
 */
export function applyTextDiff(ytext: Y.Text, next: string, origin: unknown): void {
  const prev = ytext.toString();
  if (prev === next) return;

  const a = Array.from(prev);
  const b = Array.from(next);

  let start = 0;
  const aLen = a.length;
  const bLen = b.length;
  while (start < aLen && start < bLen && a[start] === b[start]) start += 1;

  let endA = aLen;
  let endB = bLen;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }

  // Offsets/lengths for Y.Text are in UTF-16 code units; derive them from the
  // code-point slices so a pair is never cut in half.
  const offsetUnits = a.slice(0, start).join('').length;
  const deleteUnits = a.slice(start, endA).join('').length;
  const insertStr = b.slice(start, endB).join('');

  const run = () => {
    if (deleteUnits > 0) ytext.delete(offsetUnits, deleteUnits);
    if (insertStr.length > 0) ytext.insert(offsetUnits, insertStr);
  };

  const doc = ytext.doc;
  if (doc) doc.transact(run, origin);
  else run();
}

export interface FitResult {
  fontPx: number;
  overflow: boolean;
}

/**
 * Binary-search the largest integer font size in [STICKY_FONT_MIN_PX,
 * STICKY_FONT_MAX_PX] at which the element's content fits within `box`
 * (its inner height in board units). Leaves `el.style.fontSize` at the chosen
 * size. When even the minimum size overflows, sets the minimum and reports
 * `overflow` so the caller can clip and show a bottom fade.
 *
 * Requires real layout (browser); not exercised in jsdom.
 */
export function fitFontSize(el: HTMLElement, box: number): FitResult {
  let lo = STICKY_FONT_MIN_PX;
  let hi = STICKY_FONT_MAX_PX;
  let best = STICKY_FONT_MIN_PX;
  let fits = false;

  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    el.style.fontSize = `${mid}px`;
    if (el.scrollHeight <= box) {
      best = mid;
      fits = true;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  const finalPx = fits ? best : STICKY_FONT_MIN_PX;
  el.style.fontSize = `${finalPx}px`;
  return { fontPx: finalPx, overflow: !fits };
}
