// Pure text logic + font measurement for sticky notes. See the sticky.text
// contract. The generic clamp / minimal-diff primitives now live in
// `src/shared/text-edit.ts` (shared with story 9's text objects); this module
// re-exports them with the sticky character budget so story 2's callers and
// tests are unchanged. `counterVisible` and `fitFontSize` stay here because they
// are sticky-note specific (the counter threshold and the auto-fit range).
//
// All length counting is in UTF-16 code units (String.prototype.length) to match
// the character budget in the PRD; the diff and clamp never split a surrogate
// pair, so an astral character (emoji) is always kept whole or dropped whole.

import * as Y from 'yjs';
import {
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_TEXT_MAX_CHARS,
} from '../../shared/config';
import {
  applyTextDiff as applyTextDiffShared,
  clampToLimit as clampToLimitShared,
} from '../../shared/text-edit';

// Re-export the generic primitives unchanged (their signatures are already
// type-agnostic); only `clampToLimit` below gains the sticky default budget.
export {
  applyTextDelta,
  caretAfterRemoteEdit,
  textDelta,
  type TextDelta,
  type TextOp,
} from '../../shared/text-edit';

/**
 * Cap `next` at `max` characters (default STICKY_TEXT_MAX_CHARS). If the cut
 * would land between the halves of a surrogate pair, the dangling high surrogate
 * is dropped too, so a multi-code-unit character is never split.
 */
export function clampToLimit(
  next: string,
  max: number = STICKY_TEXT_MAX_CHARS,
): string {
  return clampToLimitShared(next, max);
}

/**
 * Write `next` into `ytext` using the minimal change: keep the common prefix and
 * common suffix, then at most one delete and one insert, inside a single
 * transaction tagged with `origin`. A full replace would clobber concurrent typing
 * by other users once story 3 syncs, hence the minimal diff. No-op (no
 * transaction) when the text is unchanged.
 */
export function applyTextDiff(
  ytext: Y.Text,
  next: string,
  origin: unknown,
): void {
  applyTextDiffShared(ytext, next, origin);
}

/**
 * True when the note is within STICKY_COUNTER_THRESHOLD_CHARS of the limit
 * (i.e. remaining <= threshold), including when it is at the limit already.
 */
export function counterVisible(length: number): boolean {
  return STICKY_TEXT_MAX_CHARS - length <= STICKY_COUNTER_THRESHOLD_CHARS;
}

/**
 * Find the largest integer font size in [STICKY_FONT_MIN_PX, STICKY_FONT_MAX_PX]
 * at which `el`'s content fits within `box` pixels of height, and leave the
 * element sized at that value. When even the minimum size does not fit, return
 * the minimum with `overflow: true` so the caller can show the bottom fade.
 */
export function fitFontSize(
  el: HTMLElement,
  box: number,
): { fontPx: number; overflow: boolean } {
  const fitsAt = (px: number): boolean => {
    el.style.fontSize = `${px}px`;
    return el.scrollHeight <= box;
  };

  if (!fitsAt(STICKY_FONT_MIN_PX)) {
    return { fontPx: STICKY_FONT_MIN_PX, overflow: true };
  }
  if (fitsAt(STICKY_FONT_MAX_PX)) {
    return { fontPx: STICKY_FONT_MAX_PX, overflow: false };
  }

  // Invariant: `lo` fits, `hi` does not. Narrow to adjacent integers.
  let lo = STICKY_FONT_MIN_PX;
  let hi = STICKY_FONT_MAX_PX;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (fitsAt(mid)) lo = mid;
    else hi = mid;
  }
  fitsAt(lo); // leave the element sized at the chosen (largest fitting) value
  return { fontPx: lo, overflow: false };
}
