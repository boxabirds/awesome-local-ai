import type * as Y from 'yjs';
import {
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_SIZE_WORLD,
  STICKY_TEXT_MAX_CHARS,
  STICKY_COUNTER_THRESHOLD_CHARS,
} from '../../shared/config';
import {
  applyTextDiff as applyTextDiffShared,
  clampToLimit as clampToLimitShared,
} from '../../shared/text-edit';

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
 * height and `scrollHeight` already includes the padding; comparing to the note
 * height is the correct fit test. Story 7 made notes resizable, so the box is the
 * note's own height; the default is the size a note has never been resized from.
 */
export const stickyTextContentBox = (noteHeight?: number): number =>
  noteHeight !== undefined && noteHeight > 0 ? noteHeight : STICKY_SIZE_WORLD;

/**
 * Keep at most `max` characters (default STICKY_TEXT_MAX_CHARS). Story 9 moved the
 * maths to `src/shared/text-edit.ts` so a sticky note and a text object clamp the
 * same way; this is the note's own default over the shared function, so every
 * story 2 caller and test is unchanged.
 */
export function clampToLimit(
  next: string,
  max: number = STICKY_TEXT_MAX_CHARS,
): string {
  return clampToLimitShared(next, max);
}

/**
 * Write `next` into `ytext` with the smallest change, so a concurrent typist
 * (story 3) never loses their edits. The shared implementation; re-exported for
 * story 2's callers.
 */
export function applyTextDiff(ytext: Y.Text, next: string, origin: unknown): void {
  applyTextDiffShared(ytext, next, origin);
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
