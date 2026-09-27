// Sticky note text: length clamp, minimal Y.Text diff, counter visibility,
// font auto-fit (see spec: sticky.text). Pure functions — no React.

import * as Y from 'yjs';
import { STICKY_COUNTER_THRESHOLD_CHARS, STICKY_FONT_MAX_PX, STICKY_FONT_MIN_PX, STICKY_TEXT_MAX_CHARS } from '../../shared/config';

function isTrailingSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

/** Keep at most `max` characters (default STICKY_TEXT_MAX_CHARS), surrogate-pair safe. */
export function clampToLimit(next: string, max: number = STICKY_TEXT_MAX_CHARS): string {
  if (next.length <= max) return next;
  let cut = next.slice(0, max);
  // Never leave a lone trailing surrogate at the end of the kept text.
  if (cut.length > 0 && isTrailingSurrogate(cut.charCodeAt(cut.length - 1))) {
    cut = cut.slice(0, cut.length - 1);
  }
  return cut;
}

/**
 * Bring `ytext` to `next` with the minimal change: common prefix + common
 * suffix, so at most one delete and one insert in a single transaction. A
 * full replace would destroy concurrent typing once story 3 ships.
 */
export function applyTextDiff(ytext: Y.Text, next: string, origin: unknown): void {
  const current = ytext.toString();
  if (current === next) return;
  const minLen = Math.min(current.length, next.length);
  let p = 0;
  while (p < minLen && current.charCodeAt(p) === next.charCodeAt(p)) p += 1;
  // Do not cut the diff inside a surrogate pair.
  if (p > 0 && isTrailingSurrogate(current.charCodeAt(p - 1))) p -= 1;
  let s = 0;
  while (s < minLen - p && current.charCodeAt(current.length - 1 - s) === next.charCodeAt(next.length - 1 - s)) {
    s += 1;
  }
  if (s > 0 && isTrailingSurrogate(current.charCodeAt(current.length - s))) s -= 1;
  const del = current.length - p - s;
  const ins = next.slice(p, next.length - s);
  if (del === 0 && ins.length === 0) return;
  const apply = () => {
    if (del > 0) ytext.delete(p, del);
    if (ins.length > 0) ytext.insert(p, ins);
  };
  const ydoc = ytext.doc;
  if (ydoc === null) {
    // Standalone Y.Text (unit tests): apply without a transaction.
    apply();
  } else {
    ydoc.transact(apply, origin);
  }
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
