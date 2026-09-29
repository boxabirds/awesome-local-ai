// Shared text-edit helpers (story 9).
//
// The two pure text operations story 2 grew behind the sticky note's editor,
// lifted so the free text object clamps and diffs the same way with its own
// limits. `clampToLimit` takes its maximum as an argument - a sticky keeps
// 1,000 characters and a text object 5,000 - and `applyTextDiff` knows nothing
// about limits at all: it only ever writes the minimal edit, which is what lets
// concurrent typing (story 3, story 9 TC-29) survive inside one Y.Text.
import type * as Y from 'yjs';

// Drop characters beyond the limit; the kept text is a prefix of the input.
export function clampToLimit(next: string, max: number): string {
  return next.length > max ? next.slice(0, max) : next;
}

// Apply the minimal edit (common prefix + common suffix) that turns the current
// Y.Text content into `next`, inside a single transaction with the given origin.
// No transaction is opened when the text is unchanged.
export function applyTextDiff(ytext: Y.Text, next: string, origin: unknown): void {
  const prev = ytext.toString();
  if (prev === next) return;

  const maxPrefix = Math.min(prev.length, next.length);
  let prefix = 0;
  while (prefix < maxPrefix && prev.charCodeAt(prefix) === next.charCodeAt(prefix)) {
    prefix++;
  }

  const maxSuffix = Math.min(prev.length - prefix, next.length - prefix);
  let suffix = 0;
  while (
    suffix < maxSuffix &&
    prev.charCodeAt(prev.length - 1 - suffix) === next.charCodeAt(next.length - 1 - suffix)
  ) {
    suffix++;
  }

  const deleteLen = prev.length - prefix - suffix;
  const insertStr = next.slice(prefix, next.length - suffix);

  const doc = ytext.doc;
  const run = () => {
    if (deleteLen > 0) ytext.delete(prefix, deleteLen);
    if (insertStr.length > 0) ytext.insert(prefix, insertStr);
  };
  if (doc) doc.transact(run, origin);
  else run();
}
