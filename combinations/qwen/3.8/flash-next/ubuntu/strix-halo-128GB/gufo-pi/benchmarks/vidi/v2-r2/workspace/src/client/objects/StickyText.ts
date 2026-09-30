import type * as Y from 'yjs';
import {
  STICKY_TEXT_MAX_CHARS,
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
} from '@shared/config';
import { clampToLimit as _clampToLimit, applyTextDiff as _applyTextDiff } from '@shared/text-edit';

export function clampToLimit(next: string, max: number = STICKY_TEXT_MAX_CHARS): string {
  return _clampToLimit(next, max);
}

export function applyTextDiff(ytext: Y.Text, next: string, origin: unknown): void {
  _applyTextDiff(ytext, next, origin);
}

export function counterVisible(length: number): boolean {
  const remaining = STICKY_TEXT_MAX_CHARS - length;
  return remaining <= STICKY_COUNTER_THRESHOLD_CHARS;
}

export function fitFontSize(
  el: HTMLElement,
  box: number,
): { fontPx: number; overflow: boolean } {
  // Binary search for the largest font size in [STICKY_FONT_MIN_PX, STICKY_FONT_MAX_PX]
  // where scrollHeight <= box.
  let lo = STICKY_FONT_MIN_PX;
  let hi = STICKY_FONT_MAX_PX;
  let bestFit = STICKY_FONT_MIN_PX;

  // Try max first
  el.style.fontSize = `${hi}px`;
  if (el.scrollHeight <= box) {
    return { fontPx: hi, overflow: false };
  }

  // Try min
  el.style.fontSize = `${lo}px`;
  if (el.scrollHeight > box) {
    return { fontPx: lo, overflow: true };
  }

  // Binary search
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    el.style.fontSize = `${mid}px`;
    if (el.scrollHeight <= box) {
      bestFit = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  return { fontPx: bestFit, overflow: false };
}
