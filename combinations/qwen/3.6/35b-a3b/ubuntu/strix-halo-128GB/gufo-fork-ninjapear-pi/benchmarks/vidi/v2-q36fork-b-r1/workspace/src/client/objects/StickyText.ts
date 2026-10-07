import { clampToLimit as _clamp, applyTextDiff as _apply } from '@/shared/text-edit';
import {
  STICKY_TEXT_MAX_CHARS,
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_FONT_MIN_PX,
  STICKY_FONT_MAX_PX,
} from '@/shared/config';

// Re-export with sticky-specific max for backwards compatibility
export function clampToLimit(next: string, max = STICKY_TEXT_MAX_CHARS): string {
  return _clamp(next, max);
}

export function applyTextDiff(ytext: any, next: string, origin: unknown): void {
  return _apply(ytext, next, origin);
}

/**
 * Determine if the character counter should be shown.
 * Shows when remaining chars <= threshold.
 */
export function counterVisible(length: number): boolean {
  const remaining = STICKY_TEXT_MAX_CHARS - length;
  return remaining <= STICKY_COUNTER_THRESHOLD_CHARS && remaining >= 0;
}

/**
 * Binary search for the largest font size in [minPx, maxPx] where
 * scrollHeight fits within boxWidth × boxHeight.
 * @returns { fontPx, overflow } — whether text overflows at the minimum size.
 */
export function fitFontSize(
  el: HTMLElement,
  boxSize: number,
): { fontPx: number; overflow: boolean } {
  let lo = STICKY_FONT_MIN_PX;
  let hi = STICKY_FONT_MAX_PX;
  let best = STICKY_FONT_MIN_PX;

  while (lo <= hi) {
    const mid = Math.round((lo + hi) / 2);
    el.style.fontSize = `${mid}px`;
    el.style.padding = '8px';

    if (el.scrollHeight <= boxSize) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  return {
    fontPx: best,
    overflow: best === STICKY_FONT_MIN_PX && el.scrollHeight > boxSize,
  };
}
