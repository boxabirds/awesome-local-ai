/**
 * Shared text-editing utilities used by both sticky notes and text objects.
 *
 * `clampToLimit` and `applyTextDiff` are moved here from `src/client/objects/StickyText.ts`
 * so both types share them. `StickyText.ts` re-exports with STICKY_TEXT_MAX_CHARS
 * so story 2 callers and tests are unchanged.
 */
import * as Y from 'yjs';

/** Clamp a string to at most `max` characters. */
export function clampToLimit(next: string, max: number): string {
  return next.length <= max ? next : next.slice(0, max);
}

/**
 * Apply a minimal diff between the current Y.Text content and `next`.
 * Uses common prefix + common suffix to find the minimal insert/delete region.
 * Surrogate-pair safe: never splits inside a code point.
 */
export function applyTextDiff(ytext: Y.Text, next: string, origin: unknown): void {
  const current = ytext.toString();
  if (current === next) return;

  // Find common prefix length
  let prefix = 0;
  const minLen = Math.min(current.length, next.length);
  while (prefix < minLen && current[prefix] === next[prefix]) {
    prefix++;
  }

  // Find common suffix length
  let suffix = 0;
  while (
    suffix < minLen - prefix &&
    current[current.length - 1 - suffix] === next[next.length - 1 - suffix]
  ) {
    suffix++;
  }

  // Adjust prefix/suffix to avoid splitting surrogate pairs
  // Check if prefix boundary falls between high and low surrogate
  if (prefix > 0 && prefix < current.length) {
    const charBefore = current.charCodeAt(prefix - 1);
    if (charBefore >= 0xd800 && charBefore <= 0xdbff) {
      // prefix ends with a high surrogate, back up
      prefix--;
    }
  }
  if (prefix < current.length) {
    const charAtPrefix = current.charCodeAt(prefix);
    if (charAtPrefix >= 0xdc00 && charAtPrefix <= 0xdfff) {
      // prefix ends before a low surrogate, back up
      prefix--;
    }
  }
  // Recalculate suffix after prefix adjustment
  suffix = 0;
  const minLen2 = Math.min(current.length - prefix, next.length - prefix);
  while (
    suffix < minLen2 &&
    current[current.length - 1 - suffix] === next[next.length - 1 - suffix]
  ) {
    suffix++;
  }
  // Ensure suffix doesn't overlap with prefix adjustments for surrogates
  if (suffix > 0 && suffix < next.length) {
    const charAtSuffixStart = next.charCodeAt(next.length - suffix);
    if (charAtSuffixStart >= 0xdc00 && charAtSuffixStart <= 0xdfff) {
      suffix--;
    }
  }

  const deleteCount = current.length - prefix - suffix;
  const insertStr = next.slice(prefix, next.length - suffix);

  ytext.doc!.transact(() => {
    if (deleteCount > 0) {
      ytext.delete(prefix, deleteCount);
    }
    if (insertStr.length > 0) {
      ytext.insert(prefix, insertStr);
    }
  }, origin);
}
