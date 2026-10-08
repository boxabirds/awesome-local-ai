import { STICKY_TEXT_MAX_CHARS, STICKY_COUNTER_THRESHOLD_CHARS, STICKY_FONT_MAX_PX, STICKY_FONT_MIN_PX } from '../../shared/config'
import { clampToLimit as _clamp, applyTextDiff as _diff } from '../../shared/text-edit'

/** Clamp to max chars; defaults to STICKY_TEXT_MAX_CHARS for sticky notes. */
export function clampToLimit(next: string, max: number = STICKY_TEXT_MAX_CHARS): string {
  return _clamp(next, max)
}

/** Apply a minimal diff to ytext. */
export const applyTextDiff = _diff

/**
 * Returns true when the character counter should be shown, i.e. when the
 * remaining characters (limit − current length) ≤ STICKY_COUNTER_THRESHOLD_CHARS.
 */
export function counterVisible(length: number): boolean {
  const remaining = STICKY_TEXT_MAX_CHARS - length
  return remaining <= STICKY_COUNTER_THRESHOLD_CHARS
}

/**
 * Binary-search for the largest integer font size in
 * [STICKY_FONT_MIN_PX, STICKY_FONT_MAX_PX] at which the content of el fits
 * within `box` pixels (scrollHeight ≤ box).
 *
 * In jsdom scrollHeight is always 0, so the function always returns
 * STICKY_FONT_MAX_PX. The e2e suite covers real text layout.
 */
export function fitFontSize(
  el: HTMLElement,
  box: number,
): { fontPx: number; overflow: boolean } {
  // Quick check: does it fit at the maximum size?
  el.style.fontSize = STICKY_FONT_MAX_PX + 'px'
  if (el.scrollHeight <= box) return { fontPx: STICKY_FONT_MAX_PX, overflow: false }

  let lo = STICKY_FONT_MIN_PX
  let hi = STICKY_FONT_MAX_PX - 1
  let best = STICKY_FONT_MIN_PX

  while (lo <= hi) {
    const mid = (lo + hi) >>> 1
    el.style.fontSize = mid + 'px'
    if (el.scrollHeight <= box) {
      best = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }

  // Check whether even the minimum size overflows
  el.style.fontSize = STICKY_FONT_MIN_PX + 'px'
  const overflow = el.scrollHeight > box

  return { fontPx: best, overflow }
}
