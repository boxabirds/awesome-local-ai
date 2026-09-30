/**
 * Shared text editing helpers used by both sticky notes and text objects.
 *
 * Extracted from `src/client/objects/StickyText.ts` (story 2) so both object
 * types share the same clamp and minimal-diff logic.
 */

import type * as Y from 'yjs';

/** Keep at most `max` characters: everything past the limit is dropped. */
export function clampToLimit(next: string, max: number): string {
  return next.length <= max ? next : next.slice(0, max);
}

/**
 * Write `next` into `ytext` with the smallest change that produces it: one
 * delete and/or one insert, inside a single transaction. A no-op change writes
 * nothing and emits nothing.
 */
export function applyTextDiff(ytext: Y.Text, next: string, origin: unknown): void {
  const before = ytext.toString();
  if (before === next) return;
  const edit = minimalEdit(before, next);
  const apply = (): void => {
    if (edit.deleteLength > 0) ytext.delete(edit.at, edit.deleteLength);
    if (edit.text.length > 0) ytext.insert(edit.at, edit.text);
  };
  // A detached Y.Text (before it is attached to a document) has no
  // transactions; apply the change directly.
  if (ytext.doc === null) apply();
  else ytext.doc.transact(apply, origin);
}

interface MinimalEdit {
  /** Index the change starts at, in UTF-16 units. */
  at: number;
  /** How many characters of the old text are removed. */
  deleteLength: number;
  /** What is inserted at `at`. */
  text: string;
}

/** Common prefix and common suffix, so only the middle is rewritten. */
function minimalEdit(before: string, next: string): MinimalEdit {
  let prefix = 0;
  const maxPrefix = Math.min(before.length, next.length);
  while (prefix < maxPrefix && before.charCodeAt(prefix) === next.charCodeAt(prefix)) {
    prefix += 1;
  }
  // Never end the prefix between the halves of a surrogate pair: the pair is
  // then rewritten as a whole instead of being torn in two.
  if (prefix > 0 && splitsSurrogatePair(before, prefix)) prefix -= 1;

  let suffix = 0;
  const maxSuffix = Math.min(before.length - prefix, next.length - prefix);
  while (
    suffix < maxSuffix &&
    before.charCodeAt(before.length - 1 - suffix) === next.charCodeAt(next.length - 1 - suffix)
  ) {
    suffix += 1;
  }
  if (suffix > 0 && splitsSurrogatePair(before, before.length - suffix)) suffix -= 1;

  return {
    at: prefix,
    deleteLength: before.length - prefix - suffix,
    text: next.slice(prefix, next.length - suffix),
  };
}

/** True when index `at` falls between a high and a low surrogate. */
function splitsSurrogatePair(text: string, at: number): boolean {
  if (at <= 0 || at >= text.length) return false;
  const before = text.charCodeAt(at - 1);
  const after = text.charCodeAt(at);
  const isHighSurrogate = before >= 0xd800 && before <= 0xdbff;
  const isLowSurrogate = after >= 0xdc00 && after <= 0xdfff;
  return isHighSurrogate || isLowSurrogate;
}
