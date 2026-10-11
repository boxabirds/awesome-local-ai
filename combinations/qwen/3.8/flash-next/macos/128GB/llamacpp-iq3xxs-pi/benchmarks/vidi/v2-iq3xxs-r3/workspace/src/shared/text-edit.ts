/**
 * Shared text-editing logic (story 2 for sticky notes, story 9 for text
 * objects): the length limit and the minimal diff into a `Y.Text`. Both are
 * pure, and both are the whole reason a story 3 merge survives a re-typed
 * field — so they live in one place and the two object types share them.
 */

import type * as Y from 'yjs';

/** Keep at most `max` characters; the extra characters are not added. */
export function clampToLimit(next: string, max: number): string {
  return next.length <= max ? next : next.slice(0, max);
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

/** True when index `at` in `text` sits between the halves of a surrogate pair. */
function splitsPair(text: string, at: number): boolean {
  if (at <= 0 || at >= text.length) return false;
  return isHighSurrogate(text.charCodeAt(at - 1)) && isLowSurrogate(text.charCodeAt(at));
}

/**
 * Write `next` into `ytext` with the minimal change (common prefix + common
 * suffix): at most one delete and one insert in one transaction. Required so
 * concurrent typing by others (story 3) is never destroyed — a delete-all +
 * insert-all would overwrite what someone else typed a moment ago.
 *
 * Diff boundaries never split a surrogate pair: an emoji is deleted or kept
 * whole (the Yjs positions are UTF-16 code units, like JS string indexes).
 * A no-op edit opens no transaction, so a stale input costs no sync traffic.
 */
export function applyTextDiff(ytext: Y.Text, next: string, origin: unknown): void {
  const current = ytext.toString();
  if (current === next) return;
  const doc = ytext.doc;
  if (!doc) return; // detached text (the object was deleted mid-edit): write nothing

  const minLen = Math.min(current.length, next.length);
  let prefix = 0;
  while (prefix < minLen && current[prefix] === next[prefix]) prefix += 1;
  if (splitsPair(current, prefix) || splitsPair(next, prefix)) prefix -= 1;

  let suffix = 0;
  while (
    suffix < minLen - prefix &&
    current[current.length - 1 - suffix] === next[next.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  if (
    suffix > 0 &&
    (splitsPair(current, current.length - suffix) || splitsPair(next, next.length - suffix))
  ) {
    suffix -= 1;
  }

  const deleteLength = current.length - prefix - suffix;
  const insertText = next.slice(prefix, next.length - suffix);

  doc.transact(() => {
    if (deleteLength > 0) ytext.delete(prefix, deleteLength);
    if (insertText.length > 0) ytext.insert(prefix, insertText);
  }, origin);
}
