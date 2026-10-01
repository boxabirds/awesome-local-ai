import * as Y from 'yjs';

/**
 * Story 9 (shared with story 2): keep at most `max` characters. Characters
 * beyond the limit are dropped (PRD text.limit).
 */
export function clampToLimit(next: string, max: number): string {
  if (next.length <= max) return next;
  return next.slice(0, max);
}

/**
 * Apply the minimal change from the Y.Text's current value to `next`, computed
 * as a common prefix + common suffix, so the result is at most one delete and
 * one insert. This preserves concurrent edits by others (story 3) instead of
 * replacing the whole string. Surrogate-pair safe: boundaries only land where
 * units differ, so a shared pair is always kept whole.
 */
export function applyTextDiff(ytext: Y.Text, next: string, origin: unknown): void {
  const old = ytext.toString();
  if (old === next) return;

  const oldLen = old.length;
  const nextLen = next.length;

  // Common prefix.
  let start = 0;
  while (start < oldLen && start < nextLen && old.charCodeAt(start) === next.charCodeAt(start)) {
    start++;
  }
  // Common suffix (never overlapping the prefix).
  let oldEnd = oldLen;
  let nextEnd = nextLen;
  while (
    oldEnd > start &&
    nextEnd > start &&
    old.charCodeAt(oldEnd - 1) === next.charCodeAt(nextEnd - 1)
  ) {
    oldEnd--;
    nextEnd--;
  }

  const delLen = oldEnd - start;
  const insStr = next.slice(start, nextEnd);

  const apply = () => {
    if (delLen > 0) ytext.delete(start, delLen);
    if (insStr.length > 0) ytext.insert(start, insStr);
  };

  if (ytext.doc) {
    ytext.doc.transact(apply, origin);
  } else {
    apply();
  }
}
