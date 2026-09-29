import type * as Y from 'yjs';
import {
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_SIZE_WORLD,
  STICKY_TEXT_MAX_CHARS,
  STICKY_COUNTER_THRESHOLD_CHARS,
} from '../../shared/config';

/**
 * Pure text helpers for sticky notes: length clamping, the minimal Y.Text diff,
 * the counter threshold and font auto-fit. See design.md "Sticky note text
 * editing and fit" (anchor sticky.text). Framework-free so it is unit-testable
 * without a renderer.
 */

/** Text inset from the note edge, in world units. */
export const STICKY_TEXT_PADDING_WORLD = 16;

/**
 * The height a text element's `scrollHeight` must stay under to fit. The text
 * element fills the note (border-box), so its `clientHeight` is the full note
 * size and `scrollHeight` already includes the padding; comparing to the note
 * size is the correct fit test.
 */
export const stickyTextContentBox = (): number => STICKY_SIZE_WORLD;

const isHighSurrogate = (code: number): boolean =>
  code >= 0xd800 && code <= 0xdbff;
const isLowSurrogate = (code: number): boolean =>
  code >= 0xdc00 && code <= 0xdfff;

/**
 * Keep at most `max` characters (default STICKY_TEXT_MAX_CHARS). Typing or
 * pasting past the limit adds nothing beyond the limit. Never splits a surrogate
 * pair at the cut.
 */
export function clampToLimit(next: string, max: number = STICKY_TEXT_MAX_CHARS): string {
  if (next.length <= max) return next;
  let cut = max;
  // If the cut lands right after a high surrogate, drop it so we do not leave a
  // lone high surrogate behind.
  if (cut > 0 && isHighSurrogate(next.charCodeAt(cut - 1))) cut -= 1;
  return next.slice(0, cut);
}

/**
 * Write `next` into `ytext` with the smallest change (common prefix + common
 * suffix kept), so a concurrent typist (story 3) never loses their edits. Surrogate
 * pairs are never split. Does nothing (no transaction) when unchanged.
 */
export function applyTextDiff(ytext: Y.Text, next: string, origin: unknown): void {
  const doc = ytext.doc;
  if (!doc) return;
  const current = ytext.toString();
  if (current === next) return;

  let start = 0;
  const maxStart = Math.min(current.length, next.length);
  while (start < maxStart && current.charCodeAt(start) === next.charCodeAt(start)) {
    start += 1;
  }
  // Do not end the common prefix in the middle of a surrogate pair.
  if (start > 0 && isHighSurrogate(current.charCodeAt(start - 1))) start -= 1;

  let endCur = current.length;
  let endNext = next.length;
  while (
    endCur > start &&
    endNext > start &&
    current.charCodeAt(endCur - 1) === next.charCodeAt(endNext - 1)
  ) {
    endCur -= 1;
    endNext -= 1;
  }
  // Do not begin the common suffix in the middle of a surrogate pair.
  if (endCur > start && isLowSurrogate(current.charCodeAt(endCur))) {
    endCur -= 1;
    endNext -= 1;
  }

  const deleteLength = endCur - start;
  const inserted = next.slice(start, endNext);
  if (deleteLength === 0 && inserted.length === 0) return;

  doc.transact(() => {
    if (deleteLength > 0) ytext.delete(start, deleteLength);
    if (inserted.length > 0) ytext.insert(start, inserted);
  }, origin);
}

/** The counter is shown when this many characters or fewer remain. */
export function counterVisible(length: number): boolean {
  return STICKY_TEXT_MAX_CHARS - length <= STICKY_COUNTER_THRESHOLD_CHARS;
}

/**
 * Largest integer font size in [STICKY_FONT_MIN_PX, STICKY_FONT_MAX_PX] at which
 * the element's content still fits `box` pixels tall. When even the smallest
 * size overflows, `overflow` is true (the caller clips and shows a fade). The
 * font is in board units, so the caller measures unscaled; zoom scales uniformly.
 */
export function fitFontSize(
  el: HTMLElement,
  box: number,
): { fontPx: number; overflow: boolean } {
  const fits = (px: number): boolean => {
    el.style.fontSize = `${px}px`;
    return el.scrollHeight <= box;
  };
  if (fits(STICKY_FONT_MAX_PX)) return { fontPx: STICKY_FONT_MAX_PX, overflow: false };
  if (!fits(STICKY_FONT_MIN_PX)) return { fontPx: STICKY_FONT_MIN_PX, overflow: true };

  let lo = STICKY_FONT_MIN_PX; // known to fit
  let hi = STICKY_FONT_MAX_PX; // known not to fit
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (fits(mid)) lo = mid;
    else hi = mid;
  }
  return { fontPx: lo, overflow: false };
}
