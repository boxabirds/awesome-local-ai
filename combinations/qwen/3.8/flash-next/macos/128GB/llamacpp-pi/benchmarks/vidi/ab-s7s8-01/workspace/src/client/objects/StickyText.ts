import * as Y from 'yjs';
import { STICKY_TEXT_MAX_CHARS, STICKY_COUNTER_THRESHOLD_CHARS, STICKY_FONT_MIN_PX, STICKY_FONT_MAX_PX } from '../../shared/config';

/** Truncate to the character limit. Never grows the string. */
export function clampToLimit(next: string, max: number = STICKY_TEXT_MAX_CHARS): string {
  return next.length <= max ? next : next.slice(0, max);
}

/** True when the remaining character budget has fallen to (or below) the
 * counter threshold, i.e. the counter should be shown. */
export function counterVisible(length: number): boolean {
  const remaining = STICKY_TEXT_MAX_CHARS - length;
  return remaining <= STICKY_COUNTER_THRESHOLD_CHARS;
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}
function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

/**
 * Write `next` into `ytext` with the minimal change: a common prefix and a
 * common suffix are left untouched, and only the differing middle is replaced
 * (one delete and/or one insert, inside a single transaction). A full replace
 * would destroy concurrent typing once story 3 syncs, so the diff is required,
 * not just an optimisation.
 *
 * Surrogate pairs are kept intact: the cut points are widened so a delete never
 * splits a pair, and a lone low surrogate is never emitted as a replacement.
 */
export function applyTextDiff(ytext: Y.Text, next: string, origin: unknown): void {
  const current = ytext.toString();
  if (current === next) return;
  const doc = ytext.doc;

  const run = () => {
    // Longest common prefix.
    let start = 0;
    const minLen = Math.min(current.length, next.length);
    while (start < minLen && current.charCodeAt(start) === next.charCodeAt(start)) start += 1;

    // Longest common suffix, not overlapping the prefix.
    let endCur = current.length;
    let endNext = next.length;
    while (endCur > start && endNext > start && current.charCodeAt(endCur - 1) === next.charCodeAt(endNext - 1)) {
      endCur -= 1;
      endNext -= 1;
    }

    // Do not split a surrogate pair at either cut point.
    if (start < current.length && isLowSurrogate(current.charCodeAt(start)) && start > 0) start -= 1;
    if (endCur < current.length && isHighSurrogate(current.charCodeAt(endCur - 1)) && endCur >= 2) endCur += 1;

    const deleteLen = endCur - start;
    const inserted = next.slice(start, endNext);
    // Never emit an orphan low surrogate at the start of the inserted run: it
    // would render as a replacement character.
    const cleanInserted =
      inserted.length > 0 && isLowSurrogate(inserted.charCodeAt(0)) && !isHighSurrogate(inserted.charCodeAt(1) ?? 0)
        ? inserted.slice(1)
        : inserted;

    if (deleteLen > 0) ytext.delete(start, deleteLen);
    if (cleanInserted.length > 0) ytext.insert(start, cleanInserted);
  };

  if (doc) doc.transact(run, origin);
  else run();
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