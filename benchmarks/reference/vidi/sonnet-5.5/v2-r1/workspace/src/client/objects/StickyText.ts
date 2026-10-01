import type * as Y from 'yjs';
import {
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_TEXT_MAX_CHARS,
} from '../../shared/config';

const HIGH_SURROGATE_MIN = 0xd800;
const HIGH_SURROGATE_MAX = 0xdbff;
const LOW_SURROGATE_MIN = 0xdc00;
const LOW_SURROGATE_MAX = 0xdfff;

function isHigh(code: number): boolean {
  return code >= HIGH_SURROGATE_MIN && code <= HIGH_SURROGATE_MAX;
}
function isLow(code: number): boolean {
  return code >= LOW_SURROGATE_MIN && code <= LOW_SURROGATE_MAX;
}

export function clampToLimit(next: string, max: number = STICKY_TEXT_MAX_CHARS): string {
  if (next.length <= max) return next;
  // Do not split a surrogate pair.
  const cut = isHigh(next.charCodeAt(max - 1)) ? max - 1 : max;
  return next.slice(0, cut);
}

export function counterVisible(length: number): boolean {
  return STICKY_TEXT_MAX_CHARS - length <= STICKY_COUNTER_THRESHOLD_CHARS;
}

/** Writes the smallest change (common prefix and suffix kept) turning `ytext` into `next`. */
export function applyTextDiff(ytext: Y.Text, next: string, origin: unknown): void {
  const prev = ytext.toString();
  if (prev === next) return;
  const maxPrefix = Math.min(prev.length, next.length);
  let start = 0;
  while (start < maxPrefix && prev.charCodeAt(start) === next.charCodeAt(start)) start++;
  if (start > 0 && isHigh(prev.charCodeAt(start - 1))) start--;
  let endPrev = prev.length;
  let endNext = next.length;
  while (endPrev > start && endNext > start && prev.charCodeAt(endPrev - 1) === next.charCodeAt(endNext - 1)) {
    endPrev--;
    endNext--;
  }
  if (endPrev < prev.length && isLow(prev.charCodeAt(endPrev))) {
    endPrev++;
    endNext++;
  }
  const apply = () => {
    if (endPrev > start) ytext.delete(start, endPrev - start);
    if (endNext > start) ytext.insert(start, next.slice(start, endNext));
  };
  if (ytext.doc) ytext.doc.transact(apply, origin);
  else apply();
}

export type TextDelta = { insert?: unknown; delete?: number; retain?: number }[];

/** Moves a caret position through a remote Y.Text delta so the local caret stays next to the same characters. */
export function mapCaretThroughDelta(pos: number, delta: TextDelta): number {
  let oldIndex = 0; // position in the text before the change
  let result = pos;
  for (const op of delta) {
    if (op.retain !== undefined) {
      oldIndex += op.retain;
    } else if (typeof op.insert === 'string') {
      if (oldIndex < pos) result += op.insert.length; // an insert exactly at the caret leaves the caret before it
    } else if (op.delete !== undefined) {
      if (oldIndex < pos) result -= Math.min(op.delete, pos - oldIndex);
      oldIndex += op.delete;
    }
  }
  return Math.max(0, result);
}

/** Largest integer font size in [min, max] whose content height fits in `box`. Sets `el.style.fontSize`. */
export function fitFontSize(el: HTMLElement, box: number): { fontPx: number; overflow: boolean } {
  let lo = STICKY_FONT_MIN_PX;
  let hi = STICKY_FONT_MAX_PX;
  const fits = (px: number) => {
    el.style.fontSize = `${px}px`;
    return el.scrollHeight <= box;
  };
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (fits(mid)) lo = mid;
    else hi = mid - 1;
  }
  const overflow = !fits(lo);
  return { fontPx: lo, overflow };
}
