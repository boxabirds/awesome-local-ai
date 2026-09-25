/**
 * Pure sticky-note text logic: length limit, counter rule, minimal Y.Text diff and font fit.
 * The limit and diff live in shared/text-edit.ts since story 9 (free text uses them too); they
 * are re-exported here so story 2 callers are unchanged.
 */
import { applyTextDiff, clampToLimit as clampShared } from '../../shared/text-edit';
import {
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_TEXT_MAX_CHARS,
} from '../../shared/config';

export { applyTextDiff };

const HALF = 2;

/** Cuts `next` to at most `max` (default STICKY_TEXT_MAX_CHARS) UTF-16 code units without splitting a surrogate pair. */
export function clampToLimit(next: string, max: number = STICKY_TEXT_MAX_CHARS): string {
  return clampShared(next, max);
}

/** True when the character counter should show: remaining <= STICKY_COUNTER_THRESHOLD_CHARS. */
export function counterVisible(length: number): boolean {
  return STICKY_TEXT_MAX_CHARS - length <= STICKY_COUNTER_THRESHOLD_CHARS;
}

/**
 * Finds the largest integer font size in [STICKY_FONT_MIN_PX, STICKY_FONT_MAX_PX] at which
 * `el`'s content fits in `box` px of height (`scrollHeight <= box`), by binary search over
 * real layout. Leaves `el.style.fontSize` at the result. `overflow` is true when even the
 * minimum size does not fit.
 */
export function fitFontSize(el: HTMLElement, box: number): { fontPx: number; overflow: boolean } {
  const fits = (px: number) => {
    el.style.fontSize = `${px}px`;
    return el.scrollHeight <= box;
  };
  if (fits(STICKY_FONT_MAX_PX)) return { fontPx: STICKY_FONT_MAX_PX, overflow: false };
  if (!fits(STICKY_FONT_MIN_PX)) return { fontPx: STICKY_FONT_MIN_PX, overflow: true };
  // Invariant: lo fits, hi does not.
  let lo = STICKY_FONT_MIN_PX;
  let hi = STICKY_FONT_MAX_PX;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / HALF);
    if (fits(mid)) lo = mid;
    else hi = mid;
  }
  el.style.fontSize = `${lo}px`;
  return { fontPx: lo, overflow: false };
}

/** One Yjs text delta operation (as in `YTextEvent.delta`). */
export interface TextDeltaOp {
  insert?: string | object;
  retain?: number;
  delete?: number;
}

/**
 * Maps a caret index in the text before a change to the same place after it. Insertions
 * exactly at the caret land after it (the caret stays before them), so the person typing
 * keeps typing where they were while someone else's words appear next to theirs.
 */
export function transformIndex(index: number, delta: readonly TextDeltaOp[]): number {
  let oldPos = 0;
  let result = index;
  for (const op of delta) {
    if (op.retain !== undefined) {
      oldPos += op.retain;
    } else if (op.insert !== undefined) {
      const length = typeof op.insert === 'string' ? op.insert.length : 1;
      if (oldPos < index) result += length;
    } else if (op.delete !== undefined) {
      result -= Math.min(Math.max(index - oldPos, 0), op.delete);
      oldPos += op.delete;
    }
  }
  return result;
}
