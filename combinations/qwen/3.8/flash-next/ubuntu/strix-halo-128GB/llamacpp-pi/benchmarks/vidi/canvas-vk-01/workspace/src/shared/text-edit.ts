import * as Y from 'yjs';

/**
 * Shared plain-text editing helpers used by both sticky notes and text
 * objects. Moved out of `src/client/objects/StickyText.ts` in story 9 so the
 * two object types clamp and diff identically.
 */

/** Clamp a string to at most `max` characters. Surrogate-pair safe. */
export function clampToLimit(next: string, max: number): string {
  if (next.length <= max) return next;
  // Avoid splitting a surrogate pair at the boundary
  let cut = max;
  if (cut > 0 && next.charCodeAt(cut - 1) >= 0xD800 && next.charCodeAt(cut - 1) <= 0xDBFF) {
    cut -= 1;
  }
  return next.slice(0, cut);
}

/**
 * Apply a minimal diff from `ytext`'s current content to `next`.
 * Uses common prefix + common suffix to produce at most one delete + one insert.
 */
export function applyTextDiff(ytext: Y.Text, next: string, origin: unknown): void {
  const current = ytext.toString();
  if (current === next) return;

  // Find common prefix length (codepoint-aware)
  let prefix = 0;
  const minLen = Math.min(current.length, next.length);
  while (prefix < minLen && current[prefix] === next[prefix]) {
    prefix++;
  }

  // Find common suffix length (codepoint-aware, not overlapping with prefix)
  let suffix = 0;
  while (
    suffix < minLen - prefix &&
    current[current.length - 1 - suffix] === next[next.length - 1 - suffix]
  ) {
    suffix++;
  }

  const deleteCount = current.length - prefix - suffix;
  const insertText = next.slice(prefix, next.length - suffix);

  if (deleteCount === 0 && insertText.length === 0) return;

  ytext.doc?.transact(() => {
    ytext.delete(prefix, deleteCount);
    if (insertText.length > 0) {
      ytext.insert(prefix, insertText);
    }
  }, origin ?? undefined);
}
