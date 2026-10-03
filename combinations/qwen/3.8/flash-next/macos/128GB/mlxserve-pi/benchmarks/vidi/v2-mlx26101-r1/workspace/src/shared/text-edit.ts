// The text-editing primitives shared by every board object that carries a
// `Y.Text` — sticky notes (story 2) and free text (story 9). They lived in
// `src/client/objects/StickyText.ts` until story 9 needed the exact same clamp
// and minimal-diff write for text objects, so they moved here (framework-free,
// no sticky-specific defaults) and `StickyText.ts` re-exports them with the
// sticky character budget. Keeping one copy is what makes story 3's concurrent
// typing behave identically for both types.
//
// All length counting is in UTF-16 code units (String.prototype.length) to match
// the character budgets in the PRDs; the clamp and diff never split a surrogate
// pair, so an astral character (emoji) is always kept whole or dropped whole.

import * as Y from 'yjs';

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

/**
 * Cap `next` at `max` characters. If the cut would land between the halves of a
 * surrogate pair, the dangling high surrogate is dropped too, so a multi-code-unit
 * character is never split. (text.limit / sticky.text.)
 */
export function clampToLimit(next: string, max: number): string {
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
 * by other users once sync lands, hence the minimal diff. No-op (no transaction)
 * when the text is unchanged.
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
