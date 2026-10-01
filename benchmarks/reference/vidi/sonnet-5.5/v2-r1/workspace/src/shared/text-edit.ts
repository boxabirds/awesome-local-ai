import type * as Y from 'yjs';

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

export function clampToLimit(next: string, max: number): string {
  if (next.length <= max) return next;
  // Do not split a surrogate pair.
  const cut = isHigh(next.charCodeAt(max - 1)) ? max - 1 : max;
  return next.slice(0, cut);
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
