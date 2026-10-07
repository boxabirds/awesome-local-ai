import * as Y from 'yjs';
import { LOCAL_ORIGIN } from './board-model';

// ---------------------------------------------------------------------------
// Text helpers shared by every board object that holds a `Y.Text`: sticky notes
// (story 2) and free text (story 9). Everything here is pure, so the length
// limit and the minimal Yjs diff (required so concurrent typing is never
// destroyed) are unit-tested without a DOM. `src/client/objects/StickyText.ts`
// re-exports these with the sticky defaults, so story 2 callers are unchanged.
// ---------------------------------------------------------------------------

/**
 * Keep at most `max` characters; characters beyond the limit are dropped, so a
 * 1,200 character paste into a 1,000 character limit stores exactly the first
 * 1,000. The cut never splits a surrogate pair.
 */
export function clampToLimit(next: string, max: number): string {
  if (max < 0 || !Number.isFinite(max)) return '';
  if (next.length <= max) return next;
  let end = max;
  // Drop a trailing high surrogate so the limit cannot split an emoji.
  const code = next.charCodeAt(end - 1);
  if (code >= 0xd800 && code <= 0xdbff) end -= 1;
  return next.slice(0, end);
}

const isLowSurrogate = (code: number): boolean => code >= 0xdc00 && code <= 0xdfff;

/** Start index of the code point that contains the unit at `index`. */
function codePointStart(s: string, index: number): number {
  const code = s.charCodeAt(index);
  return isLowSurrogate(code) && index > 0 ? index - 1 : index;
}

/** Common prefix length in UTF-16 units, never splitting a surrogate pair. */
function commonPrefixUnits(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length) {
    const ca = a.codePointAt(i)!;
    const cb = b.codePointAt(i)!;
    if (ca !== cb) break;
    i += ca > 0xffff ? 2 : 1;
  }
  return i;
}

/** Common suffix length in UTF-16 units, capped and pair-safe. */
function commonSuffixUnits(a: string, b: string, max: number): number {
  let units = 0;
  let ia = a.length - 1;
  let ib = b.length - 1;
  while (units < max && ia >= 0 && ib >= 0) {
    const startA = codePointStart(a, ia);
    const startB = codePointStart(b, ib);
    const chunkA = a.slice(startA, ia + 1);
    const chunkB = b.slice(startB, ib + 1);
    if (chunkA !== chunkB) break;
    units += ia - startA + 1;
    ia = startA - 1;
    ib = startB - 1;
  }
  return units;
}

/**
 * Write `next` into `ytext` with the smallest possible change: at most one
 * delete and one insert, found from the common prefix and suffix. A full
 * replace would overwrite text other users typed between our cursor and the
 * sync, which is exactly what the minimal diff protects.
 *
 * A no-op performs no transaction, so it emits no update (no sync traffic).
 */
export function applyTextDiff(
  ytext: Y.Text,
  next: string,
  origin: unknown = LOCAL_ORIGIN,
): void {
  const prev = ytext.toString();
  if (prev === next) return;

  const prefix = commonPrefixUnits(prev, next);
  const suffix = commonSuffixUnits(prev, next, Math.min(prev.length, next.length) - prefix);
  const deleteLength = prev.length - prefix - suffix;
  const insertText = next.slice(prefix, next.length - suffix);

  const run = (): void => {
    if (deleteLength > 0) ytext.delete(prefix, deleteLength);
    if (insertText.length > 0) ytext.insert(prefix, insertText);
  };

  const doc = ytext.doc;
  if (doc) doc.transact(run, origin);
  else run();
}

/**
 * A remote change to a text we are currently typing in (story 3). `delta` is the
 * `Y.Text` delta of the transaction; local selections are UTF-16 ranges into the
 * *previous* text, which is what the delta is relative to as well.
 */
export interface TextSelection {
  readonly start: number;
  readonly end: number;
}

export interface RemoteTextChange {
  readonly value: string;
  readonly selection: TextSelection;
}

/** One operation of a `Y.Text` delta (embeds are treated as zero-width). */
export type DeltaOp = { retain?: number; insert?: string | unknown; delete?: number };

/** A boundary when text is inserted at `pos` (a boundary at `pos` stays behind). */
const shiftForInsert = (boundary: number, pos: number, length: number): number =>
  boundary > pos ? boundary + length : boundary;

/** A boundary when [pos, until) is deleted (one inside the hole lands at its start). */
const shiftForDelete = (boundary: number, pos: number, until: number): number =>
  boundary <= pos ? boundary : boundary < until ? pos : boundary - (until - pos);

/**
 * Apply somebody else's change to the textarea we are typing in, keeping the
 * caret where the person left it (PRD live.concurrent_text): text inserted before
 * the caret pushes it along, text deleted before it pulls it back, and a caret
 * inside deleted text lands at the start of the hole. The local caret is never
 * jumped to the end of the object, and the local text is never lost — which is
 * the same reason the local write is a minimal diff rather than a replace.
 */
export function applyRemoteDelta(
  value: string,
  selection: TextSelection,
  delta: readonly DeltaOp[],
): RemoteTextChange {
  let { start, end } = selection;
  let out = '';
  let pos = 0;
  for (const op of delta) {
    if (typeof op.retain === 'number') {
      out += value.slice(pos, pos + op.retain);
      pos += op.retain;
    } else if ('insert' in op) {
      const text = typeof op.insert === 'string' ? op.insert : '';
      start = shiftForInsert(start, pos, text.length);
      end = shiftForInsert(end, pos, text.length);
      out += text;
    } else if (typeof op.delete === 'number') {
      const until = pos + op.delete;
      start = shiftForDelete(start, pos, until);
      end = shiftForDelete(end, pos, until);
      pos = until;
    }
  }
  out += value.slice(pos);
  return { value: out, selection: { start, end } };
}
