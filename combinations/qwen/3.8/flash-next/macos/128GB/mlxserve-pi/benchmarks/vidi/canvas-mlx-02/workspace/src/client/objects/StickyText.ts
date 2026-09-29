// Sticky note text helpers (story 2).
//
// Pure text logic (clamp, minimal diff, counter visibility) plus the font-fit
// measurement used by the display/editor. The minimal diff is required so that
// concurrent typing by other users (story 3) is preserved: a full replace
// would destroy their inserts.
//
// Story 9 lifted the clamp and the diff into src/shared/text-edit.ts so the
// free text object clamps and diffs the same way with its own limit; what is
// left here is the sticky note's 1,000-character default, the character
// counter and the font fit — all unchanged.
import {
  clampToLimit as clampToGeneric,
  applyTextDiff,
} from '../../shared/text-edit.ts';
import {
  STICKY_TEXT_MAX_CHARS,
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_FONT_MIN_PX,
  STICKY_FONT_MAX_PX,
} from '../../shared/config.ts';

export { applyTextDiff };

// Drop characters beyond the limit; the kept text is a prefix of the input.
// Sticky notes default to STICKY_TEXT_MAX_CHARS; a call with an explicit
// maximum (the unit tests) passes one.
export function clampToLimit(next: string, max: number = STICKY_TEXT_MAX_CHARS): string {
  return clampToGeneric(next, max);
}

// Whether the character counter should be shown for a note of `length`
// characters: only when the remaining characters are within the threshold.
export function counterVisible(length: number): boolean {
  return STICKY_TEXT_MAX_CHARS - length <= STICKY_COUNTER_THRESHOLD_CHARS;
}

export interface FitResult {
  fontPx: number;
  overflow: boolean;
}

// Binary-search the largest integer font size in [MIN, MAX] at which the
// element's content still fits (scrollHeight <= box). Restores the element's
// font size to the chosen value. When even MIN does not fit, returns MIN with
// overflow = true (the caller shows a bottom fade and clips).
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

  el.style.fontSize = `${best}px`;
  return { fontPx: best, overflow: !fits };
}

export { STICKY_COUNTER_THRESHOLD_CHARS };
