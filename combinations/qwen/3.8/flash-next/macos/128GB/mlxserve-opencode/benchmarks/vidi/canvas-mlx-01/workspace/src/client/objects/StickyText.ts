/**
 * Sticky-note text helpers: the pure parts (clamp, minimal diff, counter visibility)
 * and font auto-fit by measurement. The React editor lives in `StickyTextEditor.tsx`.
 *
 * The diff is deliberately minimal — a common prefix/suffix rewrite inside one
 * transaction — so a full replace never happens: a full replace would destroy the
 * concurrent typing of other users once story 3 ships.
 */
import * as Y from 'yjs';
import {
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_TEXT_MAX_CHARS,
} from '../../shared/config.js';

/**
 * Inner padding of a note's text box, in CSS pixels at 100% zoom. It is a single
 * constant so the measured text box is `STICKY_SIZE_WORLD - 2 * NOTE_PADDING_PX` and
 * the display div and the editing textarea always agree on where the text sits.
 */
export const NOTE_PADDING_PX = 12;

const isHigh = (code: number): boolean => code >= 0xd800 && code <= 0xdbff;
const isLow = (code: number): boolean => code >= 0xdc00 && code <= 0xdfff;

/** Cap a value at `max` characters (default STICKY_TEXT_MAX_CHARS), never cutting a surrogate pair. */
export function clampToLimit(next: string, max: number = STICKY_TEXT_MAX_CHARS): string {
  if (next.length <= max) return next;
  let cut = max;
  // Drop a leading high surrogate stranded at the cut so we never emit a lone surrogate.
  if (cut > 0 && isHigh(next.charCodeAt(cut - 1))) cut -= 1;
  return next.slice(0, cut);
}

/** Rewrite `ytext` to `next` with the minimal insert/delete inside one transaction. */
export function applyTextDiff(ytext: Y.Text, next: string, origin: unknown): void {
  const current = ytext.toString();
  if (current === next) return;

  const oldLen = current.length;
  const newLen = next.length;

  let prefix = 0;
  while (
    prefix < oldLen &&
    prefix < newLen &&
    current.charCodeAt(prefix) === next.charCodeAt(prefix)
  ) {
    prefix += 1;
  }
  // Never end the kept prefix on a high surrogate (its pair would be deleted alone).
  if (prefix > 0 && isHigh(current.charCodeAt(prefix - 1))) prefix -= 1;

  let suffix = 0;
  while (
    suffix < oldLen - prefix &&
    suffix < newLen - prefix &&
    current.charCodeAt(oldLen - 1 - suffix) === next.charCodeAt(newLen - 1 - suffix)
  ) {
    suffix += 1;
  }
  // Keep surrogate pairs whole at the suffix boundary: back off one code unit when the
  // kept suffix would start on a low surrogate, or the deleted region would end on a
  // high surrogate.
  if (suffix > 0) {
    const firstKept = current.charCodeAt(oldLen - suffix);
    const lastDeleted = current.charCodeAt(oldLen - suffix - 1);
    if (isLow(firstKept) || isHigh(lastDeleted)) suffix -= 1;
  }

  const delLength = oldLen - prefix - suffix;
  const insert = next.slice(prefix, newLen - suffix);

  const run = (): void => {
    if (delLength > 0) ytext.delete(prefix, delLength);
    if (insert.length > 0) ytext.insert(prefix, insert);
  };

  const doc = ytext.doc;
  if (doc) doc.transact(run, origin);
  else run();
}

/** Whether the counter should show for a text of `length` (remaining <= threshold). */
export function counterVisible(length: number): boolean {
  return STICKY_TEXT_MAX_CHARS - length <= STICKY_COUNTER_THRESHOLD_CHARS;
}

/**
 * Pick the largest integer font size in [STICKY_FONT_MIN_PX, STICKY_FONT_MAX_PX] whose
 * rendered text fits inside `box` (the element's inner content height). Writes the
 * chosen size to `el.style.fontSize` as a side effect. When even the smallest size
 * overflows, it stays at the minimum and returns `overflow: true`.
 */
export function fitFontSize(
  el: HTMLElement,
  box: number,
): { fontPx: number; overflow: boolean } {
  const fitsAt = (size: number): boolean => {
    el.style.fontSize = `${size}px`;
    return el.scrollHeight <= box;
  };

  let low = STICKY_FONT_MIN_PX;
  let high = STICKY_FONT_MAX_PX;
  let best = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (fitsAt(mid)) {
      best = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  if (best === -1) {
    // Nothing fits: pin to the smallest size and report the overflow.
    el.style.fontSize = `${STICKY_FONT_MIN_PX}px`;
    return { fontPx: STICKY_FONT_MIN_PX, overflow: true };
  }
  return { fontPx: best, overflow: false };
}
