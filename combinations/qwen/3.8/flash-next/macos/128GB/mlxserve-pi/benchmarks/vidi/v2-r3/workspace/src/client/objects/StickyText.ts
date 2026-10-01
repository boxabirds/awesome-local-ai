// Sticky note text helpers: the length limit, the counter rule, the minimal
// textarea -> Y.Text diff and the auto-fit font measurement. Pure logic, no
// React, so the diff and the limit are unit-testable against a real Y.Text.
import * as Y from 'yjs';
import {
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_TEXT_MAX_CHARS,
} from '../../shared/config';

/**
 * Keep at most `max` (default STICKY_TEXT_MAX_CHARS = 1,000) characters: a
 * typing or pasting action that would go past the limit adds nothing beyond
 * the 1,000th character.
 */
export function clampToLimit(next: string, max: number = STICKY_TEXT_MAX_CHARS): string {
  return next.length <= max ? next : next.slice(0, max);
}

/**
 * The counter appears only near the limit: when STICKY_COUNTER_THRESHOLD_CHARS
 * (50) characters or fewer remain, i.e. from 950 characters onwards.
 */
export function counterVisible(length: number): boolean {
  return STICKY_TEXT_MAX_CHARS - length <= STICKY_COUNTER_THRESHOLD_CHARS;
}

/** UTF-16 length of a run of code points (a surrogate pair counts as 2). */
function utf16Length(codePoints: string[]): number {
  let total = 0;
  for (const point of codePoints) total += point.length;
  return total;
}

/**
 * Write `next` into `ytext` with the minimal change: the common prefix and
 * common suffix are kept, so one keystroke is one insert (or delete) — never
 * delete-all + insert-all, which would destroy what other people are typing
 * (story 3). Diffing on code points means a surrogate pair is never cut in
 * half; the whole pair is inserted or removed.
 *
 * The change runs in exactly one transaction with `origin` (LOCAL_ORIGIN from
 * the editor), which stories 3 and 8 use to recognise local edits.
 */
export function applyTextDiff(ytext: Y.Text, next: string, origin: unknown): void {
  const current = ytext.toString();
  if (current === next) return;

  const before = Array.from(current);
  const after = Array.from(next);

  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let endBefore = before.length;
  let endAfter = after.length;
  while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) {
    endBefore--;
    endAfter--;
  }

  const deleteAt = utf16Length(before.slice(0, start));
  const deleteLength = utf16Length(before.slice(start, endBefore));
  const insertText = after.slice(start, endAfter).join('');
  if (deleteLength === 0 && insertText === '') return;

  const apply = () => {
    // Delete first, then insert at the same offset: one delete and/or one
    // insert, and the resulting delta reads retain / delete / insert.
    if (deleteLength > 0) ytext.delete(deleteAt, deleteLength);
    if (insertText !== '') ytext.insert(deleteAt, insertText);
  };
  const doc = ytext.doc;
  if (doc === null) apply();
  else doc.transact(apply, origin);
}

export interface FontFit {
  /** Font size (board units) the note text is drawn at. */
  fontPx: number;
  /** True when even the minimum size does not fit: clip and fade the bottom. */
  overflow: boolean;
}

/**
 * Largest integer font size in [STICKY_FONT_MIN_PX, STICKY_FONT_MAX_PX] at
 * which the element's whole text fits inside `box` (its inner height), found
 * by binary search — text layout is monotonic in font size. When even the
 * minimum size overflows, `overflow` is true: the caller clips the text and
 * fades the bottom edge instead of drawing outside the note.
 *
 * `el` is measured (and its inline font-size restored), so this leaves the
 * DOM as it found it; zoom scales the whole note uniformly, which is why the
 * fit only has to be computed at 100 % zoom — i.e. in board units.
 */
export function fitFontSize(el: HTMLElement, box: number): FontFit {
  const previous = el.style.fontSize;
  let low = STICKY_FONT_MIN_PX;
  let high = STICKY_FONT_MAX_PX;
  let best = 0; // 0 = nothing fitted, not even the minimum size

  const fitsAt = (size: number): boolean => {
    el.style.fontSize = `${size}px`;
    return el.scrollHeight <= box;
  };

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (fitsAt(mid)) {
      best = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  el.style.fontSize = previous;
  return { fontPx: best === 0 ? STICKY_FONT_MIN_PX : best, overflow: best === 0 };
}
