import {
  STICKY_TEXT_MAX_CHARS,
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
} from 'src/shared/config';

// Story 9: clampToLimit / applyTextDiff / adjustCaret moved to the shared
// text-edit module so sticky notes and text objects share them; re-exported
// here so story 2 callers and tests are unchanged (default
// STICKY_TEXT_MAX_CHARS).
export {
  clampToLimit,
  applyTextDiff,
  adjustCaret,
  type TextDeltaOp,
} from 'src/shared/text-edit';

/** True when the remaining character budget is within STICKY_COUNTER_THRESHOLD_CHARS. */
export function counterVisible(length: number): boolean {
  return STICKY_TEXT_MAX_CHARS - length <= STICKY_COUNTER_THRESHOLD_CHARS;
}

/**
 * Binary search over integer px sizes in [STICKY_FONT_MIN_PX, STICKY_FONT_MAX_PX]
 * for the largest font at which the element's content fits in `box`
 * (scrollHeight <= box). The element's font-size is left set to the result.
 *
 * Returns the chosen fontPx and whether the text still overflows at the
 * minimum size (caller then hides overflow and shows a bottom fade).
 *
 * Must be run on text change and on mount only: the font is in world units,
 * so board zoom scales it uniformly and needs no re-measurement.
 */
export function fitFontSize(el: HTMLElement, box: number): { fontPx: number; overflow: boolean } {
  let lo = STICKY_FONT_MIN_PX;
  let hi = STICKY_FONT_MAX_PX;
  let best = STICKY_FONT_MIN_PX;

  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    el.style.fontSize = `${mid}px`;
    if (el.scrollHeight <= box) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  el.style.fontSize = `${best}px`;
  const overflow = el.scrollHeight > box;
  return { fontPx: best, overflow };
}
