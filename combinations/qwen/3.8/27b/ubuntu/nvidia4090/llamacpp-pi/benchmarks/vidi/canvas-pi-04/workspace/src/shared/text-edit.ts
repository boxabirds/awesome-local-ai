// Story 9: shared text-editing helpers (anchor: text.editor).
//
// Moved here from story 2's StickyText.ts so sticky notes and free text share
// the exact same clamp/diff logic (design: "StickyText.ts re-exports
// clampToLimit/applyTextDiff from text-edit.ts"). Story 3 depends on
// `applyTextDiff` being a *minimal* diff: a full replace would destroy
// concurrent typing by others once the doc is shared live.

import * as Y from 'yjs';

/** Keep at most `max` characters; longer input is truncated (no wrap). */
export function clampToLimit(next: string, max: number): string {
  return next.length > max ? next.slice(0, max) : next;
}

/**
 * Bring `ytext` to exactly `next` with the minimal edit: common prefix and
 * common suffix are kept, so at most one delete and one insert are emitted
 * (inside a single transaction). Surrogate pairs in `next` are kept intact
 * because edit boundaries are derived from comparing the two full strings.
 */
export function applyTextDiff(ytext: Y.Text, next: string, origin: unknown): void {
  const current = ytext.toString();
  if (current === next) return;

  const minLen = Math.min(current.length, next.length);
  let prefix = 0;
  while (prefix < minLen && current[prefix] === next[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < minLen - prefix &&
    current[current.length - 1 - suffix] === next[next.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  const deleteLength = current.length - prefix - suffix;
  const insertText = next.slice(prefix, next.length - suffix);
  if (deleteLength === 0 && insertText.length === 0) return;

  const doc = ytext.doc;
  if (doc === null) return;
  doc.transact(
    () => {
      if (deleteLength > 0) ytext.delete(prefix, deleteLength);
      if (insertText.length > 0) ytext.insert(prefix, insertText);
    },
    origin,
  );
}
