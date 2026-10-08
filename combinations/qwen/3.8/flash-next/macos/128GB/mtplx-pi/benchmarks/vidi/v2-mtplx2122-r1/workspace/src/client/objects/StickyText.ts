import * as Y from 'yjs'
import { STICKY_TEXT_MAX_CHARS, STICKY_COUNTER_THRESHOLD_CHARS, STICKY_FONT_MAX_PX, STICKY_FONT_MIN_PX } from '../../shared/config'

/** Clamp to max chars; returns truncated copy if over limit. */
export function clampToLimit(next: string, max: number = STICKY_TEXT_MAX_CHARS): string {
  if (next.length <= max) return next
  return next.slice(0, max)
}

/**
 * Applies a minimal diff from the current content of ytext to next.
 * Uses common prefix/suffix so concurrent typing (story 3) is never
 * destroyed by overwriting the whole text.
 */
export function applyTextDiff(ytext: Y.Text, next: string, origin: unknown): void {
  const current = (ytext as Y.Text).toString()
  if (current === next) return

  const doc = (ytext as Y.Text).doc
  if (!doc) return

  doc.transact(() => {
    // Find common prefix length
    let prefix = 0
    const curLen = current.length
    const nextLen = next.length
    const minLen = Math.min(curLen, nextLen)
    while (prefix < minLen && current[prefix] === next[prefix]) prefix++

    // Find common suffix length (must not overlap prefix)
    let suffix = 0
    while (
      suffix < minLen - prefix &&
      current[curLen - 1 - suffix] === next[nextLen - 1 - suffix]
    ) {
      suffix++
    }

    const deleteLen = curLen - prefix - suffix
    const insertStr = next.slice(prefix, nextLen - suffix)

    if (deleteLen > 0) ytext.delete(prefix, deleteLen)
    if (insertStr.length > 0) ytext.insert(prefix, insertStr)
  }, origin)
}

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
