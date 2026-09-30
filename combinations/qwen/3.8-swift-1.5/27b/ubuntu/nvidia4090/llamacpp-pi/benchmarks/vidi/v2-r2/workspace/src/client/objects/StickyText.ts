import {
  STICKY_TEXT_MAX_CHARS,
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
} from '../../shared/config';
import { clampToLimit as sharedClampToLimit, applyTextDiff } from '../../shared/text-edit';

// Story 9: clampToLimit/applyTextDiff now live in the shared text-edit module
// so sticky notes and free text share them. Re-exported here (with the sticky
// default limit) so story 2 callers and tests are unchanged.
export { applyTextDiff };

/** Keeps at most `max` characters (default STICKY_TEXT_MAX_CHARS). */
export function clampToLimit(next: string, max: number = STICKY_TEXT_MAX_CHARS): string {
  return sharedClampToLimit(next, max);
}

/** True when `length` is within STICKY_COUNTER_THRESHOLD_CHARS of the limit. */
export function counterVisible(length: number): boolean {
  return STICKY_TEXT_MAX_CHARS - length <= STICKY_COUNTER_THRESHOLD_CHARS;
}

/**
 * Finds the largest integer font size in [STICKY_FONT_MIN_PX, STICKY_FONT_MAX_PX]
 * (board units, so it scales with zoom) at which `el`'s text fits inside a
 * `box` × `box` content area. Leaves `el` at the chosen size and reports
 * whether the text still overflows at the chosen size.
 *
 * Measurement uses an off-screen, height:auto probe with the same width,
 * font and wrapping as `el`'s content box: the note's text div has a fixed
 * height, so its own scrollHeight is always ≥ that height and cannot be used
 * to detect overflow.
 */
export function fitFontSize(el: HTMLElement, box: number): { fontPx: number; overflow: boolean } {
  const cs = getComputedStyle(el);
  const probe = document.createElement('div');
  probe.style.position = 'absolute';
  probe.style.visibility = 'hidden';
  probe.style.left = '-99999px';
  probe.style.top = '0';
  probe.style.width = `${box}px`;
  probe.style.whiteSpace = cs.whiteSpace;
  probe.style.wordBreak = cs.wordBreak;
  probe.style.fontFamily = cs.fontFamily;
  probe.style.fontSize = cs.fontSize;
  probe.style.lineHeight = cs.lineHeight;
  probe.style.textAlign = cs.textAlign;
  probe.textContent = el.textContent ?? '';
  document.body.appendChild(probe);

  let lo = STICKY_FONT_MIN_PX;
  let hi = STICKY_FONT_MAX_PX;
  let fontPx = STICKY_FONT_MIN_PX;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    probe.style.fontSize = `${mid}px`;
    if (probe.scrollHeight <= box) {
      fontPx = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  const overflow = probe.scrollHeight > box;
  probe.remove();

  el.style.fontSize = `${fontPx}px`;
  return { fontPx, overflow };
}
