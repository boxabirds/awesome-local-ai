// Pure sticky-note text logic: length clamp, minimal Y.Text diff, counter
// visibility and font auto-fit by measurement.

import * as Y from 'yjs';
import {
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_SIZE_WORLD,
  STICKY_TEXT_MAX_CHARS,
} from '../../shared/config';

// Inner text box of a note in board units: the note is STICKY_SIZE_WORLD with
// STICKY_PADDING_WORLD of padding on every side (see styles.css).
export const STICKY_PADDING_WORLD = 16;
export const STICKY_TEXT_BOX_WORLD = STICKY_SIZE_WORLD - STICKY_PADDING_WORLD * 2;

export function clampToLimit(next: string, max: number = STICKY_TEXT_MAX_CHARS): string {
  return next.length <= max ? next : next.slice(0, max);
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

// Minimal change with common prefix + common suffix, so a concurrent typer
// (story 3) can never be overwritten by a full replace. Boundaries are nudged
// out of surrogate pairs so an emoji is never split into lone surrogates.
export function applyTextDiff(ytext: Y.Text, next: string, origin: unknown): void {
  const prev = ytext.toString();
  if (prev === next) return;

  let p = 0;
  const minLen = Math.min(prev.length, next.length);
  while (p < minLen && prev[p] === next[p]) p++;
  // A prefix must not end between a high surrogate and its low surrogate.
  if (p > 0 && p < prev.length && isLowSurrogate(prev.charCodeAt(p))) p--;

  let s = 0;
  while (
    s < prev.length - p &&
    s < next.length - p &&
    prev[prev.length - 1 - s] === next[next.length - 1 - s]
  ) {
    s++;
  }
  // A suffix must not start between a high surrogate and its low surrogate.
  if (s > 0 && isLowSurrogate(prev.charCodeAt(prev.length - s))) s--;

  const deleteLen = prev.length - p - s;
  const insertText = next.slice(p, next.length - s);

  ytext.doc!.transact(() => {
    if (deleteLen > 0) ytext.delete(p, deleteLen);
    if (insertText.length > 0) ytext.insert(p, insertText);
  }, origin);
}

export function counterVisible(length: number): boolean {
  return STICKY_TEXT_MAX_CHARS - length <= STICKY_COUNTER_THRESHOLD_CHARS;
}

// Largest integer size in [STICKY_FONT_MIN_PX, STICKY_FONT_MAX_PX] (board
// units; zoom scales the note uniformly) at which the element's content still
// fits inside `box` px. When even the minimum overflows, `overflow` is true
// and the caller clips and fades instead.
export function fitFontSize(
  el: HTMLElement,
  box: number,
): { fontPx: number; overflow: boolean } {
  const fits = (px: number): boolean => {
    el.style.fontSize = `${px}px`;
    return el.scrollHeight <= box;
  };
  if (fits(STICKY_FONT_MAX_PX)) return { fontPx: STICKY_FONT_MAX_PX, overflow: false };
  if (!fits(STICKY_FONT_MIN_PX)) return { fontPx: STICKY_FONT_MIN_PX, overflow: true };
  let lo = STICKY_FONT_MIN_PX;
  let hi = STICKY_FONT_MAX_PX;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (fits(mid)) lo = mid;
    else hi = mid - 1;
  }
  return { fontPx: lo, overflow: false };
}
