// Pure text logic + font measurement for sticky notes. See the sticky.text
// contract. clampToLimit / applyTextDiff / counterVisible are pure and unit
// tested; fitFontSize measures a real element (exercised in e2e, jsdom has no
// text layout).
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

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

/**
 * Cap `next` at `max` characters (default STICKY_TEXT_MAX_CHARS). If the cut
 * would land between the halves of a surrogate pair, the dangling high surrogate
 * is dropped too, so a multi-code-unit character is never split.
 */
export function clampToLimit(
  next: string,
  max: number = STICKY_TEXT_MAX_CHARS,
): string {
  if (next.length <= max) return next;
  let cut = next.slice(0, max);
  if (isHighSurrogate(cut.charCodeAt(max - 1))) {
    cut = cut.slice(0, max - 1);
  }
  return cut;
}

/**
 * The smallest change that turns `base` into `next`: the common prefix and the
 * common suffix are kept, so at most one delete and one insert remain. An all
 * equal pair yields an empty delta (everything at `base.length`).
 */
export interface TextDelta {
  /** Offset in `base` (and in `next`) where the change starts. */
  start: number;
  /** Characters of `base` from `start` that the change removes. */
  deleteCount: number;
  /** Characters `next` has from `start` that `base` does not. */
  insert: string;
}

export function textDelta(base: string, next: string): TextDelta {
  const minLen = Math.min(base.length, next.length);

  let start = 0;
  while (start < minLen && base[start] === next[start]) start += 1;

  let endBase = base.length;
  let endNext = next.length;
  while (
    endBase > start &&
    endNext > start &&
    base[endBase - 1] === next[endNext - 1]
  ) {
    endBase -= 1;
    endNext -= 1;
  }

  return {
    start,
    deleteCount: endBase - start,
    insert: next.slice(start, endNext),
  };
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
  const prev = ytext.toString();
  if (prev === next) return;
  applyTextDelta(ytext, textDelta(prev, next), origin);
}

/**
 * Apply a *local* change to a shared text that may have moved on since the local
 * copy was taken: the delta is spliced into the text that is there now, so
 * characters the other person typed in between are never removed. Returns the
 * merged text, which is what the caller should show (Yjs makes every screen end
 * up with the same string).
 *
 * Positions from the local edit are clamped into the current text: with two
 * people typing at once the offsets may have shifted, and an out-of-range delete
 * is shortened rather than allowed to eat someone else's characters.
 */
export function applyTextDelta(
  ytext: Y.Text,
  delta: TextDelta,
  origin: unknown,
): string {
  const run = () => {
    const current = ytext.toString();
    const start = Math.min(delta.start, current.length);
    const deleteCount = Math.min(
      delta.deleteCount,
      Math.max(0, current.length - start),
    );
    if (deleteCount > 0) ytext.delete(start, deleteCount);
    if (delta.insert.length > 0) ytext.insert(start, delta.insert);
  };

  const doc = ytext.doc;
  if (doc) doc.transact(run, origin);
  else run();
  return ytext.toString();
}

/** A piece of a Y.Text change, in the shape `Y.TextEvent.delta` arrives in. */
export interface TextOp {
  retain?: number;
  insert?: string;
  delete?: number;
}

/**
 * Where a local caret has to move when someone else's change lands in the same
 * text: characters inserted before it push it right, characters deleted before it
 * pull it left, and a change after it does not move it at all. The result is
 * never negative.
 */
export function caretAfterRemoteEdit(
  caret: number,
  ops: readonly TextOp[],
): number {
  let position = 0;
  let shift = 0;
  for (const op of ops) {
    if (op.retain !== undefined) {
      position += op.retain;
    } else if (op.insert !== undefined) {
      if (position <= caret) shift += op.insert.length;
    } else if (op.delete !== undefined) {
      shift -= Math.min(op.delete, Math.max(0, caret - position));
      position += op.delete;
    }
  }
  return Math.max(0, caret + shift);
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
