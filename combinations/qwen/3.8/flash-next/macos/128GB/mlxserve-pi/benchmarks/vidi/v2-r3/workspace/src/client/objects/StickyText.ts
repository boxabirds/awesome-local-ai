// Sticky note text helpers: the note's own length limit, the counter rule and
// the auto-fit font measurement. Pure logic, no React, so they are unit-testable.
//
// The text rules themselves moved to `src/shared/text-edit.ts` with story 9,
// when the free text object started editing its text the same way; they are
// re-exported here with the note's own character limit so story 2's callers are
// unchanged.
import {
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_TEXT_MAX_CHARS,
} from '../../shared/config';
import { clampToLimit as clampToLimitShared } from '../../shared/text-edit';

export {
  applyTextDiff,
  applyTextDelta,
  diffText,
  type TextDelta,
} from '../../shared/text-edit';

/**
 * Keep at most `max` (default STICKY_TEXT_MAX_CHARS = 1,000) characters: a
 * typing or pasting action that would go past the limit adds nothing beyond
 * the 1,000th character.
 */
export function clampToLimit(next: string, max: number = STICKY_TEXT_MAX_CHARS): string {
  return clampToLimitShared(next, max);
}

/**
 * The counter appears only near the limit: when STICKY_COUNTER_THRESHOLD_CHARS
 * (50) characters or fewer remain, i.e. from 950 characters onwards.
 */
export function counterVisible(length: number): boolean {
  return STICKY_TEXT_MAX_CHARS - length <= STICKY_COUNTER_THRESHOLD_CHARS;
}

export interface FontFit {
  /** Font size (board units) the note text is drawn at. */
  fontPx: number;
  /** True when even the minimum size does not fit: clip and fade the bottom. */
  overflow: boolean;
}

/**
 * Largest integer font size in [STICKY_FONT_MIN_PX, STICKY_FONT_MAX_PX] at
 * which the element's whole text fits inside `box` (its inner height), found
 * by binary search — text layout is monotonic in font size. When even the
 * minimum size overflows, `overflow` is true: the caller clips the text and
 * fades the bottom edge instead of drawing outside the note.
 *
 * `el` is measured (and its inline font-size restored), so this leaves the
 * DOM as it found it; zoom scales the whole note uniformly, which is why the
 * fit only has to be computed at 100 % zoom — i.e. in board units.
 */
export function fitFontSize(el: HTMLElement, box: number): FontFit {
  const previous = el.style.fontSize;
  let low = STICKY_FONT_MIN_PX;
  let high = STICKY_FONT_MAX_PX;
  let best = 0; // 0 = nothing fitted, not even the minimum size

  const fitsAt = (size: number): boolean => {
    el.style.fontSize = `${size}px`;
    return el.scrollHeight <= box;
  };

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (fitsAt(mid)) {
      best = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  el.style.fontSize = previous;
  return { fontPx: best === 0 ? STICKY_FONT_MIN_PX : best, overflow: best === 0 };
}
