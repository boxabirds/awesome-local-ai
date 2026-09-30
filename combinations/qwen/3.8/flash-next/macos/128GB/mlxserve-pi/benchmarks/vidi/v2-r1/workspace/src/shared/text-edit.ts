// The text maths every text-bearing object shares (story 9, `text.model`).
//
// Story 2 wrote these inside `src/client/objects/StickyText.ts`, where the sticky
// note was the only kind of object with words on it. A text object is a second
// kind, and the two rules that matter — the character limit and the minimal write
// that lets two people type in one string at once — have to be the *same* rules for
// both, or one of them would lose characters. They live here, framework-free and
// DOM-free (so the Worker can read them too), and `StickyText.ts` re-exports them
// with the note's own limit as the default so story 2's callers are unchanged.
//
// Specs: spec/stories/009-write-free-text-anywhere-on-the-board/design.md
import type * as Y from 'yjs';

const isHighSurrogate = (code: number): boolean =>
  code >= 0xd800 && code <= 0xdbff;
const isLowSurrogate = (code: number): boolean =>
  code >= 0xdc00 && code <= 0xdfff;

/**
 * Keep at most `max` characters. Typing or pasting past the limit adds nothing
 * beyond the limit. Never splits a surrogate pair at the cut.
 */
export function clampToLimit(next: string, max: number): string {
  if (!(typeof max === 'number') || !Number.isFinite(max) || max < 0) return '';
  if (next.length <= max) return next;
  let cut = Math.floor(max);
  // If the cut lands right after a high surrogate, drop it so we do not leave a
  // lone high surrogate behind.
  if (cut > 0 && isHighSurrogate(next.charCodeAt(cut - 1))) cut -= 1;
  return next.slice(0, cut);
}

/**
 * Write `next` into `ytext` with the smallest change (common prefix + common
 * suffix kept), so a concurrent typist never loses their edits. Surrogate pairs
 * are never split. Does nothing (no transaction) when unchanged.
 */
export function applyTextDiff(ytext: Y.Text, next: string, origin: unknown): void {
  const doc = ytext.doc;
  if (!doc) return;
  const current = ytext.toString();
  if (current === next) return;

  let start = 0;
  const maxStart = Math.min(current.length, next.length);
  while (start < maxStart && current.charCodeAt(start) === next.charCodeAt(start)) {
    start += 1;
  }
  // Do not end the common prefix in the middle of a surrogate pair.
  if (start > 0 && isHighSurrogate(current.charCodeAt(start - 1))) start -= 1;

  let endCur = current.length;
  let endNext = next.length;
  while (
    endCur > start &&
    endNext > start &&
    current.charCodeAt(endCur - 1) === next.charCodeAt(endNext - 1)
  ) {
    endCur -= 1;
    endNext -= 1;
  }
  // Do not begin the common suffix in the middle of a surrogate pair.
  if (endCur > start && isLowSurrogate(current.charCodeAt(endCur))) {
    endCur -= 1;
    endNext -= 1;
  }

  const deleteLength = endCur - start;
  const inserted = next.slice(start, endNext);
  if (deleteLength === 0 && inserted.length === 0) return;

  doc.transact(() => {
    if (deleteLength > 0) ytext.delete(start, deleteLength);
    if (inserted.length > 0) ytext.insert(start, inserted);
  }, origin);
}
