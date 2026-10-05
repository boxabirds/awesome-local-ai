/**
 * Shared text editing helpers used by both sticky notes and text objects.
 *
 * `clampToLimit` and `applyTextDiff` were originally in `StickyText.ts`; they
 * are moved here so both object types share the same surrogate-safe logic.
 */

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

function boundarySafe(value: string, i: number): boolean {
  if (i <= 0 || i >= value.length) return true;
  return !(isHighSurrogate(value.charCodeAt(i - 1)) && isLowSurrogate(value.charCodeAt(i)));
}

/** Keep at most `max` characters, never splitting a surrogate pair. */
export function clampToLimit(next: string, max: number): string {
  if (next.length <= max) return next;
  let cut = max;
  while (cut > 0 && !boundarySafe(next, cut)) cut -= 1;
  return next.slice(0, cut);
}

/**
 * Write `next` into `ytext` using the minimal edits (common prefix and suffix
 * are kept): at most one delete and one insert, inside a single transaction.
 * No-op when the text already matches.
 */
export function applyTextDiff(ytext: Y.Text, next: string, origin: unknown): void {
  const current = ytext.toString();
  if (current === next) return;

  let prefix = 0;
  const maxPrefix = Math.min(current.length, next.length);
  while (
    prefix < maxPrefix &&
    current.charCodeAt(prefix) === next.charCodeAt(prefix)
  ) {
    prefix += 1;
  }

  let suffix = 0;
  let maxSuffix = Math.min(current.length - prefix, next.length - prefix);
  while (
    suffix < maxSuffix &&
    current.charCodeAt(current.length - suffix - 1) ===
      next.charCodeAt(next.length - suffix - 1)
  ) {
    suffix += 1;
  }

  while (prefix > 0 && (!boundarySafe(current, prefix) || !boundarySafe(next, prefix))) {
    prefix -= 1;
  }
  maxSuffix = Math.min(current.length - prefix, next.length - prefix);
  if (suffix > maxSuffix) suffix = maxSuffix;
  while (
    suffix > 0 &&
    (!boundarySafe(current, current.length - suffix) ||
      !boundarySafe(next, next.length - suffix))
  ) {
    suffix -= 1;
  }

  const deleteLength = current.length - suffix - prefix;
  const inserted = next.slice(prefix, next.length - suffix);
  if (deleteLength <= 0 && inserted.length === 0) return;

  const apply = () => {
    if (deleteLength > 0) ytext.delete(prefix, deleteLength);
    if (inserted.length > 0) ytext.insert(prefix, inserted);
  };
  if (ytext.doc) ytext.doc.transact(apply, origin);
  else apply();
}

// Re-export Y.Text type for convenience so callers don't need a separate import.
import type * as Y from 'yjs';
