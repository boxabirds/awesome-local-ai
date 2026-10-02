import * as Y from 'yjs';
import {
  STICKY_TEXT_MAX_CHARS,
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
} from '../../shared/config';

/**
 * Pure text helpers for sticky note editing (sticky.text contract).
 * The React editor lives in StickyTextEditor.tsx.
 */

/** Keeps at most `max` characters; characters past the limit are dropped (sticky.text_limit). */
export function clampToLimit(next: string, max: number = STICKY_TEXT_MAX_CHARS): string {
  return next.length > max ? next.slice(0, max) : next;
}

/**
 * True when the characters remaining are within STICKY_COUNTER_THRESHOLD_CHARS
 * of the limit (so the "n/1000" counter is shown).
 */
export function counterVisible(length: number, max: number = STICKY_TEXT_MAX_CHARS): boolean {
  return max - length <= STICKY_COUNTER_THRESHOLD_CHARS;
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

/**
 * Writes `next` into `ytext` using the smallest delete + insert pair (common
 * prefix and common suffix are left alone). A minimal diff is required so that
 * concurrent typing by another user (story 3) is never destroyed.
 * No transaction is opened when nothing changed.
 */
export function applyTextDiff(ytext: Y.Text, next: string, origin: unknown): void {
  const current = ytext.toString();
  if (current === next) return;

  const minLen = Math.min(current.length, next.length);

  let start = 0;
  while (start < minLen && current[start] === next[start]) start += 1;

  let endCurrent = current.length;
  let endNext = next.length;
  while (endCurrent > start && endNext > start && current[endCurrent - 1] === next[endNext - 1]) {
    endCurrent -= 1;
    endNext -= 1;
  }

  // Never split a surrogate pair at the edges of the changed region.
  if (endCurrent > start && start > 0 && isHighSurrogate(current.charCodeAt(start - 1))) {
    start -= 1;
  }
  if (endCurrent > start && endCurrent < current.length && isHighSurrogate(current.charCodeAt(endCurrent - 1))) {
    endCurrent -= 1;
    if (endNext > start) endNext -= 1;
  }

  const deleteLength = endCurrent - start;
  const insertText = endNext > start ? next.slice(start, endNext) : '';
  if (deleteLength <= 0 && insertText === '') return;

  const run = () => {
    if (deleteLength > 0) ytext.delete(start, deleteLength);
    if (insertText !== '') ytext.insert(start, insertText);
  };

  const doc = ytext.doc;
  if (doc) doc.transact(run, origin);
  else run();
}

/**
 * Largest integer font size within [STICKY_FONT_MIN_PX, STICKY_FONT_MAX_PX] at
 * which the element's content still fits inside `box` pixels. When even the
 * smallest size overflows, `overflow` is true (the caller clips and fades).
 * The element's own font size is used for measuring and is left at the result.
 */
export function fitFontSize(
  el: HTMLElement,
  box: number,
): { fontPx: number; overflow: boolean } {
  const fitsAt = (px: number): boolean => {
    el.style.fontSize = `${px}px`;
    return el.scrollHeight <= box;
  };

  if (fitsAt(STICKY_FONT_MAX_PX)) {
    return { fontPx: STICKY_FONT_MAX_PX, overflow: false };
  }
  if (!fitsAt(STICKY_FONT_MIN_PX)) {
    el.style.fontSize = `${STICKY_FONT_MIN_PX}px`;
    return { fontPx: STICKY_FONT_MIN_PX, overflow: true };
  }

  let lo = STICKY_FONT_MIN_PX; // fits
  let hi = STICKY_FONT_MAX_PX; // does not fit
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (fitsAt(mid)) lo = mid;
    else hi = mid;
  }

  el.style.fontSize = `${lo}px`;
  return { fontPx: lo, overflow: false };
}
