/**
 * Story 9: the shared text-editing primitives.
 *
 * They arrived with sticky notes (story 2, `client/objects/StickyText.ts`) and
 * moved here unchanged, because a text object edits its `Y.Text` in exactly the
 * same way: clamp to the type's character limit, then write the minimal
 * delete-and/or-insert so a colleague typing in the same object never loses
 * characters. `StickyText.ts` re-exports them with STICKY_TEXT_MAX_CHARS, so
 * story 2's callers are untouched.
 */

import type * as Y from 'yjs';

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

/** Keep at most `max` characters (a text object passes TEXT_MAX_CHARS). */
export function clampToLimit(next: string, max: number): string {
  return next.length <= max ? next : next.slice(0, max);
}

/**
 * Update `ytext` from its current string to `next` with the minimal
 * delete-and/or-insert (common prefix + common suffix), inside one transaction.
 * A minimal diff (not replace-all) means concurrent typing by others (story 3)
 * is never destroyed. Surrogate-pair safe: boundaries never split an emoji.
 */
export function applyTextDiff(ytext: Y.Text, next: string, origin: unknown): void {
  const current = ytext.toString();
  if (current === next) return;

  // Common prefix.
  const maxPrefix = Math.min(current.length, next.length);
  let prefix = 0;
  while (prefix < maxPrefix && current[prefix] === next[prefix]) prefix += 1;
  // Back the prefix off a split surrogate pair (the two strings share it).
  if (
    prefix > 0 &&
    prefix < current.length &&
    isHighSurrogate(current.charCodeAt(prefix - 1)) &&
    isLowSurrogate(current.charCodeAt(prefix))
  ) {
    prefix -= 1;
  }

  // Common suffix (bounded so it cannot overlap the prefix).
  const maxSuffix = Math.min(current.length, next.length) - prefix;
  let suffix = 0;
  while (
    suffix < maxSuffix &&
    current[current.length - 1 - suffix] === next[next.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  // Back the suffix off a split surrogate pair in either string.
  const cutCurrent = current.length - suffix;
  if (
    suffix > 0 &&
    cutCurrent > 0 &&
    isLowSurrogate(current.charCodeAt(cutCurrent)) &&
    isHighSurrogate(current.charCodeAt(cutCurrent - 1))
  ) {
    suffix -= 1;
  }
  const cutNext = next.length - suffix;
  if (
    suffix > 0 &&
    cutNext > 0 &&
    isLowSurrogate(next.charCodeAt(cutNext)) &&
    isHighSurrogate(next.charCodeAt(cutNext - 1))
  ) {
    suffix -= 1;
  }

  const deleteLength = current.length - prefix - suffix;
  const inserted = next.slice(prefix, next.length - suffix);

  const run = () => {
    if (deleteLength > 0) ytext.delete(prefix, deleteLength);
    if (inserted.length > 0) ytext.insert(prefix, inserted);
  };
  const doc = ytext.doc;
  if (doc) doc.transact(run, origin);
  else run();
}
