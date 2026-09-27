// Sticky note text: length clamp, minimal Y.Text diff, counter visibility,
// font auto-fit (see spec: sticky.text). Pure functions — no React.
//
// clampToLimit and applyTextDiff are shared with text objects (story 9) in
// src/shared/text-edit.ts and are re-exported here so story 2 callers are
// unchanged.

import { STICKY_COUNTER_THRESHOLD_CHARS, STICKY_FONT_MAX_PX, STICKY_FONT_MIN_PX, STICKY_TEXT_MAX_CHARS } from '../../shared/config';

export { applyTextDiff } from '../../shared/text-edit';
import { clampToLimit as sharedClampToLimit } from '../../shared/text-edit';

/** Keep at most `max` characters (default STICKY_TEXT_MAX_CHARS), surrogate-pair safe. */
export function clampToLimit(next: string, max: number = STICKY_TEXT_MAX_CHARS): string {
  return sharedClampToLimit(next, max);
}

/** A single operation in the Quill-delta change list of a Y.Text event. */
export interface TextDeltaOp {
  insert?: string | object;
  delete?: number;
  retain?: number;
}

/**
 * Map a caret (start, end) through a Quill-delta change list, so a live
 * textarea can be updated with a remote Y.Text edit without losing the caret
 * (spec: live.concurrent_text — concurrent inserts are all kept).
 */
export function shiftCaret(
  changes: TextDeltaOp[],
  start: number,
  end: number,
): { start: number; end: number } {
  let pos = 0;
  let nstart = start;
  let nend = end;
  for (const op of changes) {
    if (op.retain) pos += op.retain;
    if (op.insert != null && typeof op.insert === 'string') {
      const len = op.insert.length;
      if (pos <= start) nstart += len;
      if (pos <= end) nend += len;
    }
    if (op.delete) {
      const delEnd = pos + op.delete;
      if (pos < start) nstart -= Math.min(delEnd, start) - pos;
      if (pos < end) nend -= Math.max(0, Math.min(delEnd, end) - pos);
      pos = delEnd;
    }
  }
  nstart = Math.max(0, nstart);
  nend = Math.max(nstart, nend);
  return { start: nstart, end: nend };
}

/** True while the remaining character budget <= STICKY_COUNTER_THRESHOLD_CHARS. */
export function counterVisible(length: number): boolean {
  return STICKY_TEXT_MAX_CHARS - length <= STICKY_COUNTER_THRESHOLD_CHARS;
}

/**
 * Largest integer font size in [STICKY_FONT_MIN_PX, STICKY_FONT_MAX_PX] whose
 * rendered content height fits `box` px; `overflow` is true when even the
 * minimum size does not fit. The element must be laid out at `box` height.
 */
export function fitFontSize(el: HTMLElement, box: number): { fontPx: number; overflow: boolean } {
  let lo = STICKY_FONT_MIN_PX;
  let hi = STICKY_FONT_MAX_PX;
  let best = STICKY_FONT_MIN_PX;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    el.style.fontSize = `${mid}px`;
    if (el.scrollHeight <= box) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  el.style.fontSize = `${best}px`;
  return { fontPx: best, overflow: el.scrollHeight > box };
}
