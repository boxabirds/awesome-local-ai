import type * as Y from 'yjs';
import {
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_TEXT_MAX_CHARS,
} from '../../shared/config';

/**
 * Text helpers for sticky notes: the length limit, the minimal Y.Text diff,
 * the character counter rule and the font auto-fit measurement.
 *
 * The diff is deliberately a common prefix/suffix patch rather than a full
 * replace: once story 3 syncs, a full replace would destroy characters another
 * person typed at the same time.
 */

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

/**
 * Truncate to at most `max` characters. A cut that would split an emoji in
 * half drops the dangling high surrogate instead, so the stored text never
 * contains half a character.
 */
export function clampToLimit(
  next: string,
  max: number = STICKY_TEXT_MAX_CHARS,
): string {
  if (typeof next !== 'string') return '';
  if (!(max >= 0) || next.length <= max) return next;
  const cut = next.slice(0, max);
  return isHighSurrogate(cut.charCodeAt(cut.length - 1)) ? cut.slice(0, -1) : cut;
}

/** Longest common prefix of `a` and `b`, in UTF-16 units, never splitting an emoji. */
function commonPrefix(a: string, b: string): number {
  const limit = Math.min(a.length, b.length);
  let i = 0;
  while (i < limit && a.charCodeAt(i) === b.charCodeAt(i)) i += 1;
  // Back off when the boundary lands between the two halves of a surrogate pair.
  if (i > 0 && i < limit && isHighSurrogate(a.charCodeAt(i - 1))) i -= 1;
  return i;
}

/** Longest common suffix, bounded so it never overlaps an already-found prefix. */
function commonSuffix(a: string, b: string, after: number): number {
  const limit = Math.min(a.length, b.length) - after;
  let i = 0;
  while (
    i < limit &&
    a.charCodeAt(a.length - 1 - i) === b.charCodeAt(b.length - 1 - i)
  ) {
    i += 1;
  }
  // Back off when the boundary would split an emoji apart.
  if (i > 0) {
    const start = a.length - i;
    if (start > after && isHighSurrogate(a.charCodeAt(start - 1))) i -= 1;
  }
  return i;
}

/**
 * Write `next` into `ytext` with the smallest delete and/or insert that gets
 * there, inside a single transaction tagged with `origin` (story 8 groups undo
 * by origin; story 3 uses it to avoid echoing). An unchanged value writes
 * nothing, and text beyond STICKY_TEXT_MAX_CHARS is clamped first.
 */
export function applyTextDiff(ytext: Y.Text, next: string, origin: unknown): void {
  const current = ytext.toString();
  const wanted = clampToLimit(next);
  if (current === wanted) return;

  const prefix = commonPrefix(current, wanted);
  const suffix = commonSuffix(current, wanted, prefix);
  const deleteCount = current.length - prefix - suffix;
  const insertText = wanted.slice(prefix, wanted.length - suffix);
  if (deleteCount === 0 && insertText.length === 0) return;

  const apply = () => {
    if (deleteCount > 0) ytext.delete(prefix, deleteCount);
    if (insertText.length > 0) ytext.insert(prefix, insertText);
  };
  const doc = ytext.doc;
  if (doc) doc.transact(apply, origin);
  else apply();
}

/**
 * True when the character counter should show, i.e. at most
 * STICKY_COUNTER_THRESHOLD_CHARS characters remain before the limit.
 */
export function counterVisible(length: number): boolean {
  if (typeof length !== 'number' || !Number.isFinite(length)) return false;
  return STICKY_TEXT_MAX_CHARS - length <= STICKY_COUNTER_THRESHOLD_CHARS;
}

export interface FontFit {
  fontPx: number;
  overflow: boolean;
}

/**
 * The largest integer font size in [STICKY_FONT_MIN_PX, STICKY_FONT_MAX_PX] at
 * which the element's content still fits in a `box`-tall column. The element is
 * measured with its own font family, padding and width; only `fontSize` is
 * changed. `overflow` is true when even the smallest size is too big, which
 * turns on the bottom fade.
 */
export function fitFontSize(el: HTMLElement, box: number): FontFit {
  const measure = (px: number): boolean => {
    el.style.fontSize = `${px}px`;
    return el.scrollHeight <= box;
  };
  if (measure(STICKY_FONT_MAX_PX)) {
    return { fontPx: STICKY_FONT_MAX_PX, overflow: false };
  }
  if (!measure(STICKY_FONT_MIN_PX)) {
    return { fontPx: STICKY_FONT_MIN_PX, overflow: true };
  }
  // Binary search for the largest fitting size: MIN fits, MAX does not.
  let lo = STICKY_FONT_MIN_PX;
  let hi = STICKY_FONT_MAX_PX;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (measure(mid)) lo = mid;
    else hi = mid;
  }
  return { fontPx: lo, overflow: false };
}
