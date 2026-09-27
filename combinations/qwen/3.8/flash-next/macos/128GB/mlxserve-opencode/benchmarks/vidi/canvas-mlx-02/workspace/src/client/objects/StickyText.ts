// Sticky note text helpers (story 2).
//
// Pure text logic (clamp, minimal diff, counter visibility) plus the font-fit
// measurement used by the display/editor. The minimal diff is required so that
// concurrent typing by other users (story 3) is preserved: a full replace
// would destroy their inserts.
import type * as Y from 'yjs';
import {
  STICKY_TEXT_MAX_CHARS,
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_FONT_MIN_PX,
  STICKY_FONT_MAX_PX,
} from '../../shared/config.ts';

// Drop characters beyond the limit; the kept text is a prefix of the input.
export function clampToLimit(next: string, max: number = STICKY_TEXT_MAX_CHARS): string {
  return next.length > max ? next.slice(0, max) : next;
}

// Whether the character counter should be shown for a note of `length`
// characters: only when the remaining characters are within the threshold.
export function counterVisible(length: number): boolean {
  return STICKY_TEXT_MAX_CHARS - length <= STICKY_COUNTER_THRESHOLD_CHARS;
}

// Apply the minimal edit (common prefix + common suffix) that turns the current
// Y.Text content into `next`, inside a single transaction with the given origin.
// No transaction is opened when the text is unchanged.
export function applyTextDiff(ytext: Y.Text, next: string, origin: unknown): void {
  const prev = ytext.toString();
  if (prev === next) return;

  const maxPrefix = Math.min(prev.length, next.length);
  let prefix = 0;
  while (prefix < maxPrefix && prev.charCodeAt(prefix) === next.charCodeAt(prefix)) {
    prefix++;
  }

  const maxSuffix = Math.min(prev.length - prefix, next.length - prefix);
  let suffix = 0;
  while (
    suffix < maxSuffix &&
    prev.charCodeAt(prev.length - 1 - suffix) === next.charCodeAt(next.length - 1 - suffix)
  ) {
    suffix++;
  }

  const deleteLen = prev.length - prefix - suffix;
  const insertStr = next.slice(prefix, next.length - suffix);

  const doc = ytext.doc;
  const run = () => {
    if (deleteLen > 0) ytext.delete(prefix, deleteLen);
    if (insertStr.length > 0) ytext.insert(prefix, insertStr);
  };
  if (doc) doc.transact(run, origin);
  else run();
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
