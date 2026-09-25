/**
 * Text editing helpers shared by every object type with editable text (sticky notes,
 * free text): length limit and minimal Y.Text diff. Moved here from story 2's
 * `StickyText.ts`, which re-exports them with the sticky note limit.
 */
import type * as Y from 'yjs';

const HIGH_SURROGATE_MIN = 0xd800;
const HIGH_SURROGATE_MAX = 0xdbff;
const LOW_SURROGATE_MIN = 0xdc00;
const LOW_SURROGATE_MAX = 0xdfff;

function isHighSurrogate(code: number): boolean {
  return code >= HIGH_SURROGATE_MIN && code <= HIGH_SURROGATE_MAX;
}

function isLowSurrogate(code: number): boolean {
  return code >= LOW_SURROGATE_MIN && code <= LOW_SURROGATE_MAX;
}

/** Keeps at most `max` UTF-16 code units, never cutting a surrogate pair in half. */
export function clampToLimit(next: string, max: number): string {
  if (next.length <= max) return next;
  let end = max;
  if (end > 0 && isHighSurrogate(next.charCodeAt(end - 1))) end -= 1;
  return next.slice(0, end);
}

/**
 * Like clampToLimit, but drops the excess characters just before `caret` (where typed or
 * pasted text ends) so text after the caret is never lost. Returns the kept text and the
 * caret position in it.
 */
export function clampAtCaret(next: string, caret: number, max: number): { text: string; caret: number } {
  if (next.length <= max) return { text: next, caret };
  const over = next.length - max;
  const end = Math.min(Math.max(caret, 0), next.length);
  if (end < over) {
    const text = clampToLimit(next, max);
    return { text, caret: text.length };
  }
  let start = end - over;
  // Never cut a surrogate pair: widen the removed range to whole pairs.
  if (start > 0 && isLowSurrogate(next.charCodeAt(start)) && isHighSurrogate(next.charCodeAt(start - 1))) start -= 1;
  let stop = end;
  if (stop < next.length && isLowSurrogate(next.charCodeAt(stop)) && isHighSurrogate(next.charCodeAt(stop - 1))) stop += 1;
  return { text: next.slice(0, start) + next.slice(stop), caret: start };
}

/**
 * Applies `next` to `ytext` as one delete and/or one insert between the common prefix
 * and common suffix, in a single transaction with `origin`. Never splits surrogate pairs.
 * A full replace would destroy other people's concurrent typing.
 */
export function applyTextDiff(ytext: Y.Text, next: string, origin: unknown): void {
  const prev = ytext.toString();
  if (prev === next) return;
  const maxCommon = Math.min(prev.length, next.length);

  let prefix = 0;
  while (prefix < maxCommon && prev.charCodeAt(prefix) === next.charCodeAt(prefix)) prefix += 1;
  // Do not end the prefix between the halves of a surrogate pair.
  if (prefix > 0 && isHighSurrogate(prev.charCodeAt(prefix - 1))) prefix -= 1;

  let suffix = 0;
  const maxSuffix = maxCommon - prefix;
  while (
    suffix < maxSuffix &&
    prev.charCodeAt(prev.length - 1 - suffix) === next.charCodeAt(next.length - 1 - suffix)
  ) {
    suffix += 1;
  }
  // Do not start the suffix on the low half of a surrogate pair.
  if (suffix > 0 && isLowSurrogate(prev.charCodeAt(prev.length - suffix))) suffix -= 1;

  const deleteCount = prev.length - prefix - suffix;
  const inserted = next.slice(prefix, next.length - suffix);
  const doc = ytext.doc;
  const apply = () => {
    if (deleteCount > 0) ytext.delete(prefix, deleteCount);
    if (inserted.length > 0) ytext.insert(prefix, inserted);
  };
  if (doc === null) apply();
  else doc.transact(apply, origin);
}
