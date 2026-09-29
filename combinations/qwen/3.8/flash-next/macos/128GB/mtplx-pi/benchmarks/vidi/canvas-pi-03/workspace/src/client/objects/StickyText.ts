import * as Y from 'yjs';
import { STICKY_TEXT_MAX_CHARS, STICKY_COUNTER_THRESHOLD_CHARS, STICKY_FONT_MIN_PX, STICKY_FONT_MAX_PX } from '../../shared/config';
import { clampToLimit as clampToClamp, applyTextDiff as diffText } from '../../shared/text-edit';

/** Truncate to the character limit (default: the sticky limit). Story 9 moved
 * the shared implementation to `shared/text-edit.ts`; this wrapper keeps the
 * story 2 call sites — and their default limit — unchanged. */
export function clampToLimit(next: string, max: number = STICKY_TEXT_MAX_CHARS): string {
  return clampToClamp(next, max);
}

/** True when the remaining character budget has fallen to (or below) the
 * counter threshold, i.e. the counter should be shown. */
export function counterVisible(length: number): boolean {
  const remaining = STICKY_TEXT_MAX_CHARS - length;
  return remaining <= STICKY_COUNTER_THRESHOLD_CHARS;
}

/** Minimal-diff text write, shared with free text (see `shared/text-edit.ts`). */
export function applyTextDiff(ytext: Y.Text, next: string, origin: unknown): void {
  diffText(ytext, next, origin);
}

export interface FontFit {
  fontPx: number;
  overflow: boolean;
}

/**
 * Pick the largest integer font size in [STICKY_FONT_MIN_PX, STICKY_FONT_MAX_PX]
 * at which the element's content still fits `box` pixels tall (measured via
 * scrollHeight). When even the minimum size overflows, report `overflow: true`
 * so the caller can show the bottom fade and clip. Runs on text change/mount
 * only — the font is authored in world units, so zoom scales it uniformly.
 */
export function fitFontSize(el: HTMLElement, box: number): FontFit {
  const style = el.style;
  const original = style.fontSize;
  const fits = (size: number): boolean => {
    style.fontSize = `${size}px`;
    return el.scrollHeight <= box;
  };

  // Fast path: it already fits at the largest size.
  if (fits(STICKY_FONT_MAX_PX)) {
    style.fontSize = original;
    return { fontPx: STICKY_FONT_MAX_PX, overflow: false };
  }
  // Even the smallest size overflows.
  if (!fits(STICKY_FONT_MIN_PX)) {
    style.fontSize = original;
    return { fontPx: STICKY_FONT_MIN_PX, overflow: true };
  }

  // Binary search the largest fitting integer size.
  let lo = STICKY_FONT_MIN_PX;
  let hi = STICKY_FONT_MAX_PX;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (fits(mid)) lo = mid;
    else hi = mid - 1;
  }
  style.fontSize = original;
  return { fontPx: lo, overflow: false };
}