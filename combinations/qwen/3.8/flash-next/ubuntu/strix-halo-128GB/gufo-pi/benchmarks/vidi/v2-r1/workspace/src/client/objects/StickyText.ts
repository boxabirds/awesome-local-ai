/**
 * Note text logic, kept apart from the component so the interesting parts -
 * the minimal diff, the length limit, the counter rule and the fit search - can
 * be tested without a browser layout.
 *
 * The diff is deliberately minimal (common prefix + common suffix): story 3
 * shares these documents, and a full replace would throw away whatever somebody
 * else typed in the same note a moment ago.
 */

import type * as Y from 'yjs';

import {
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_TEXT_MAX_CHARS,
} from '../../shared/config';
import {
  clampToLimit as clampToLimitGeneral,
  applyTextDiff as applyTextDiffGeneral,
} from '../../shared/text-edit';

/** Keep at most `max` characters (defaults to STICKY_TEXT_MAX_CHARS). */
export function clampToLimit(next: string, max: number = STICKY_TEXT_MAX_CHARS): string {
  return clampToLimitGeneral(next, max);
}

/**
 * Whether the character counter should be shown: only when the remaining
 * characters are down to the threshold, so a note being written normally has no
 * counter in the way.
 */
export function counterVisible(length: number): boolean {
  return STICKY_TEXT_MAX_CHARS - length <= STICKY_COUNTER_THRESHOLD_CHARS;
}

/**
 * Write `next` into `ytext` with the smallest change that produces it.
 * Delegates to the shared text-edit module.
 */
export function applyTextDiff(ytext: Y.Text, next: string, origin: unknown): void {
  applyTextDiffGeneral(ytext, next, origin);
}

export interface FontFit {
  /** Chosen font size, always inside [STICKY_FONT_MIN_PX, STICKY_FONT_MAX_PX]. */
  fontPx: number;
  /** True when the text does not fit even at the minimum: show the fade. */
  overflow: boolean;
}

/**
 * Pick the largest integer font size, from `STICKY_FONT_MAX_PX` down to
 * `STICKY_FONT_MIN_PX`, at which the element's content still fits in `box`
 * pixels, and leave the element styled with it. Sizes are world units, so the
 * text scales with the board zoom by itself.
 *
 * When even the smallest size overflows, `overflow` is true: the caller then
 * clips the text inside the note and fades its bottom edge, so nothing is ever
 * drawn outside the note.
 *
 * Only the element's `style.fontSize` and `scrollHeight` are used, so the fit
 * can be driven from a test with a stand-in element.
 */
export function fitFontSize(el: HTMLElement, box: number): FontFit {
  const choose = (size: number): boolean => {
    el.style.fontSize = `${size}px`;
    return Number.isFinite(box) ? el.scrollHeight <= box : true;
  };

  let result: FontFit;
  if (choose(STICKY_FONT_MAX_PX)) {
    result = { fontPx: STICKY_FONT_MAX_PX, overflow: false };
  } else if (!choose(STICKY_FONT_MIN_PX)) {
    result = { fontPx: STICKY_FONT_MIN_PX, overflow: true };
  } else {
    // fits(lo), does not fit(hi): binary search the largest size that fits.
    let lo = STICKY_FONT_MIN_PX;
    let hi = STICKY_FONT_MAX_PX;
    while (hi - lo > 1) {
      const mid = Math.floor((lo + hi) / 2);
      if (choose(mid)) lo = mid;
      else hi = mid;
    }
    result = { fontPx: lo, overflow: false };
  }

  el.style.fontSize = `${result.fontPx}px`;
  return result;
}
