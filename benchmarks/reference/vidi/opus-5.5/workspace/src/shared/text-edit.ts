/**
 * Text editing helpers shared by every object type with editable text (sticky notes, story 2;
 * free text, story 9): the length limit and the minimal Y.Text diff that keeps other people's
 * concurrent typing (story 3).
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

/** Cuts `next` to at most `max` UTF-16 code units without splitting a surrogate pair. */
export function clampToLimit(next: string, max: number): string {
  if (next.length <= max) return next;
  let end = Math.max(0, Math.floor(max));
  if (end > 0 && isHighSurrogate(next.charCodeAt(end - 1))) end -= 1;
  return next.slice(0, end);
}

/**
 * Writes `next` into `ytext` as one delete and/or one insert between the common prefix and
 * common suffix, in one transaction. A full replace would destroy other people's concurrent
 * typing once edits are shared (story 3). Does nothing when the text is unchanged or the
 * Y.Text has been removed from its document (object deleted meanwhile).
 */
export function applyTextDiff(ytext: Y.Text, next: string, origin: unknown): void {
  const doc = ytext.doc;
  if (!doc || ytext._item?.deleted) return;
  const prev = ytext.toString();
  if (prev === next) return;

  const maxCommon = Math.min(prev.length, next.length);
  let prefix = 0;
  while (prefix < maxCommon && prev.charCodeAt(prefix) === next.charCodeAt(prefix)) prefix += 1;
  // Never split a surrogate pair: back off if the prefix ends on a high surrogate.
  if (prefix > 0 && isHighSurrogate(prev.charCodeAt(prefix - 1))) prefix -= 1;

  let suffix = 0;
  const maxSuffix = maxCommon - prefix;
  while (
    suffix < maxSuffix &&
    prev.charCodeAt(prev.length - 1 - suffix) === next.charCodeAt(next.length - 1 - suffix)
  ) {
    suffix += 1;
  }
  // ...or if the suffix starts on a low surrogate.
  if (suffix > 0 && isLowSurrogate(prev.charCodeAt(prev.length - suffix))) suffix -= 1;

  const deleteCount = prev.length - prefix - suffix;
  const insert = next.slice(prefix, next.length - suffix);
  doc.transact(() => {
    if (deleteCount > 0) ytext.delete(prefix, deleteCount);
    if (insert.length > 0) ytext.insert(prefix, insert);
  }, origin);
}
