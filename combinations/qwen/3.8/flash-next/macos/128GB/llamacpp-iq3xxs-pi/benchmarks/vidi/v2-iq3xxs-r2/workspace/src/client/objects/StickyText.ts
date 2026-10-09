import * as Y from 'yjs';
import {
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_TEXT_MAX_CHARS,
} from '../../shared/config';

/**
 * Pure text logic behind a sticky note's editor: the 1,000 character limit, the minimal
 * diff written into the shared `Y.Text`, the character counter and the font auto-fit.
 * Kept separate from the component so the rules are unit-testable.
 */

/**
 * Keep at most `max` characters. Typing or pasting never grows a note past the limit:
 * the characters beyond the 1,000th are simply dropped.
 */
export function clampToLimit(next: string, max: number = STICKY_TEXT_MAX_CHARS): string {
  const limit = Number.isFinite(max) && max >= 0 ? Math.floor(max) : STICKY_TEXT_MAX_CHARS;
  if (next.length <= limit) return next;
  return next.slice(0, limit);
}

/** True when the remaining characters are few enough that the counter should show. */
export function counterVisible(length: number): boolean {
  if (!Number.isFinite(length)) return false;
  return STICKY_TEXT_MAX_CHARS - length <= STICKY_COUNTER_THRESHOLD_CHARS;
}

const HIGH_SURROGATE_FIRST = 0xd800;
const HIGH_SURROGATE_LAST = 0xdbff;
const LOW_SURROGATE_FIRST = 0xdc00;
const LOW_SURROGATE_LAST = 0xdfff;

function isHighSurrogate(code: number): boolean {
  return code >= HIGH_SURROGATE_FIRST && code <= HIGH_SURROGATE_LAST;
}

function isLowSurrogate(code: number): boolean {
  return code >= LOW_SURROGATE_FIRST && code <= LOW_SURROGATE_LAST;
}

/**
 * The minimal edit between `current` and `next`: the common prefix and suffix are kept,
 * and both cut points are moved out of any UTF-16 surrogate pair so an emoji is never
 * split (which would corrupt what other people see once story 3 syncs).
 */
export function minimalEdit(
  current: string,
  next: string,
): { start: number; deleteLength: number; insertText: string } {
  const a = current;
  const b = next;
  const shorter = Math.min(a.length, b.length);

  let start = 0;
  while (start < shorter && a.charCodeAt(start) === b.charCodeAt(start)) start += 1;

  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a.charCodeAt(endA - 1) === b.charCodeAt(endB - 1)) {
    endA -= 1;
    endB -= 1;
  }

  // Never cut inside a surrogate pair: shrink the common prefix, then shrink the common
  // suffix by one code unit at a time (at most once per side for a valid pair).
  if (start > 0 && isHighSurrogate(b.charCodeAt(start - 1))) start -= 1;
  if (endB < b.length && isLowSurrogate(b.charCodeAt(endB))) {
    endA += 1;
    endB += 1;
  }

  return { start, deleteLength: Math.max(0, endA - start), insertText: b.slice(start, endB) };
}

/**
 * Write `next` into `ytext` with the smallest possible change (one delete and/or one
 * insert, inside one transaction). A value that already matches writes nothing, so no
 * update is emitted.
 *
 * The change is measured against what the shared text holds now, so this is the right
 * tool when `next` is meant to *become* the whole note (a clamp to the character limit,
 * or a model-level rewrite). An editor typing into a note it is not alone in must use
 * `applyLocalEdit` instead: whatever the shared text has that the editor has not seen
 * yet would otherwise be treated as something to delete.
 */
export function applyTextDiff(ytext: Y.Text, next: string, origin: unknown): void {
  const current = ytext.toString();
  if (current === next) return;
  const { start, deleteLength, insertText } = minimalEdit(current, next);
  if (deleteLength === 0 && insertText.length === 0) return;
  const apply = (): void => {
    if (deleteLength > 0) ytext.delete(start, deleteLength);
    if (insertText.length > 0) ytext.insert(start, insertText);
  };
  const doc = ytext.doc ?? ytext.parent;
  if (doc instanceof Y.Doc) doc.transact(apply, origin);
  else apply();
}

/**
 * Write the edit the editor itself made: the change between what the editor showed when
 * it last wrote (`previous`) and what it shows now (`next`), applied at that same place
 * in the shared text. Anything the shared text holds that the editor has not seen —
 * a word somebody else typed a moment ago — is left alone, which is what
 * `live.concurrent_text` asks for: every typed character survives on every screen.
 *
 * Offsets come from the editor, so a remote change that landed before them can leave the
 * insert one space out; it cannot lose a character. The editor mirrors remote changes as
 * they arrive, so its offsets stay close to the shared text's.
 */
export function applyLocalEdit(
  ytext: Y.Text,
  previous: string,
  next: string,
  origin: unknown,
): void {
  if (previous === next) return;
  const { start, deleteLength, insertText } = minimalEdit(previous, next);
  const current = ytext.toString();
  const removed = previous.slice(start, start + deleteLength);
  const at = removalOffset(current, removed, start);
  const remove = Math.max(0, Math.min(deleteLength, current.length - at));
  if (remove === 0 && insertText.length === 0) return;
  const apply = (): void => {
    if (remove > 0) ytext.delete(at, remove);
    if (insertText.length > 0) ytext.insert(at, insertText);
  };
  const doc = ytext.doc ?? ytext.parent;
  if (doc instanceof Y.Doc) doc.transact(apply, origin);
  else apply();
}

/**
 * Where the characters the editor removed are to be found in the shared text: at the
 * offset the editor had them, if they are still there; next occurrence after that, if
 * somebody inserted text in front of them; then anywhere; and if the other side changed
 * the text we were deleting, our own offset is as good a place as any. Position is the
 * one thing a plain string cannot carry across replicas — this is what keeps a deletion
 * from eating the wrong character while a stranger is typing in front of it.
 */
function removalOffset(current: string, removed: string, expected: number): number {
  const limit = Math.max(0, Math.min(expected, current.length));
  if (removed.length === 0) return limit;
  const near = current.indexOf(removed, limit);
  if (near >= 0) return near;
  const anywhere = current.indexOf(removed);
  if (anywhere >= 0) return anywhere;
  return limit;
}

/** One operation of a `Y.Text` delta. */
export interface TextDeltaOp {
  readonly insert?: string | object;
  readonly delete?: number;
  readonly retain?: number;
}

/**
 * Where the first change in a remote delta landed, and how much longer (or shorter) it
 * made the text — everything a caret needs to step over a change that arrived in front of
 * it, and to stay put when the change was behind it.
 */
export function remoteShift(ops: readonly TextDeltaOp[]): { at: number; shift: number } {
  let at = 0;
  let shift = 0;
  let changed = false;
  for (const op of ops) {
    if (op.insert !== undefined) {
      changed = true;
      shift += typeof op.insert === 'string' ? op.insert.length : 1;
    } else if (op.delete !== undefined) {
      changed = true;
      shift -= op.delete;
    } else if (op.retain !== undefined && !changed) {
      at += op.retain;
    }
  }
  return { at, shift };
}

/**
 * Largest integer font size in [STICKY_FONT_MIN_PX, STICKY_FONT_MAX_PX] at which the
 * element's content still fits in `box` (board units, measured with `scrollHeight`,
 * which is unaffected by the world layer's zoom transform). The size is left applied to
 * the element. `overflow` is true when even the smallest size does not fit, in which
 * case the caller clips the content and fades the bottom edge.
 */
export function fitFontSize(
  el: HTMLElement,
  box: number,
): { fontPx: number; overflow: boolean } {
  if (!Number.isFinite(box) || box <= 0) {
    return { fontPx: STICKY_FONT_MAX_PX, overflow: false };
  }
  const fitsAt = (size: number): boolean => {
    el.style.fontSize = `${size}px`;
    return el.scrollHeight <= box;
  };
  if (!fitsAt(STICKY_FONT_MIN_PX)) {
    return { fontPx: STICKY_FONT_MIN_PX, overflow: true };
  }
  if (fitsAt(STICKY_FONT_MAX_PX)) {
    return { fontPx: STICKY_FONT_MAX_PX, overflow: false };
  }
  // Largest size that still fits: binary search over the integers in range.
  let lo = STICKY_FONT_MIN_PX;
  let hi = STICKY_FONT_MAX_PX;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (fitsAt(mid)) lo = mid;
    else hi = mid;
  }
  el.style.fontSize = `${lo}px`;
  return { fontPx: lo, overflow: false };
}
