import type * as Y from 'yjs';

/**
 * Clamp a string to at most `max` characters.
 */
export function clampToLimit(next: string, max: number): string {
  return next.length <= max ? next : next.slice(0, max);
}

/**
 * Apply a minimal diff between the current Y.Text content and `next`.
 * Uses common prefix + common suffix to produce a single insert and/or delete
 * rather than replacing all content (preserves concurrent edits).
 */
export function applyTextDiff(
  ytext: Y.Text,
  next: string,
  origin: unknown,
): void {
  const current = ytext.toString();
  if (current === next) return;

  // Find common prefix length
  let prefix = 0;
  const maxPrefix = Math.min(current.length, next.length);
  while (prefix < maxPrefix && current[prefix] === next[prefix]) {
    prefix++;
  }

  // Find common suffix length (after prefix)
  let suffix = 0;
  const maxSuffix = Math.min(current.length - prefix, next.length - prefix);
  while (
    suffix < maxSuffix &&
    current[current.length - 1 - suffix] === next[next.length - 1 - suffix]
  ) {
    suffix++;
  }

  // Delete the old middle portion and insert the new middle portion
  const deleteLen = current.length - prefix - suffix;
  const insertStr = next.slice(prefix, next.length - suffix);

  ytext.doc!.transact(() => {
    if (deleteLen > 0) {
      ytext.delete(prefix, deleteLen);
    }
    if (insertStr.length > 0) {
      ytext.insert(prefix, insertStr);
    }
  }, origin);
}
