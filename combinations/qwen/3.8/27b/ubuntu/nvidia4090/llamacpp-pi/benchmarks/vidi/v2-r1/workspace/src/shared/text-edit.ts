// Shared text-edit helpers (story 9, text.editing). Moved out of
// src/client/objects/StickyText.ts in story 9 so sticky notes and free
// text share one implementation (text.editing.shared).

import * as Y from 'yjs';

/** Keep at most `max` characters; characters beyond the limit are dropped. */
export function clampToLimit(next: string, max: number): string {
  return next.length > max ? next.slice(0, max) : next;
}

/**
 * Apply the minimal change that turns `ytext` into `next`: one delete and/or
 * one insert of the differing middle (common prefix + common suffix), in a
 * single transaction. A full replace would destroy concurrent typing
 * (story 3), so the minimal diff is required.
 *
 * The diff is computed over code points so emoji surrogate pairs are never
 * split.
 */
export function applyTextDiff(ytext: Y.Text, next: string, origin: unknown): void {
  const current = ytext.toString();
  if (current === next) return;

  const cur = Array.from(current);
  const nxt = Array.from(next);
  let prefix = 0;
  while (prefix < cur.length && prefix < nxt.length && cur[prefix] === nxt[prefix]) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < cur.length - prefix &&
    suffix < nxt.length - prefix &&
    cur[cur.length - 1 - suffix] === nxt[nxt.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  const prefixStr = cur.slice(0, prefix).join('');
  const suffixStr = cur.slice(cur.length - suffix).join('');
  const deleteStart = prefixStr.length;
  const deleteLength = current.length - prefixStr.length - suffixStr.length;
  const insert = nxt.slice(prefix, nxt.length - suffix).join('');

  const apply = () => {
    if (deleteLength > 0) ytext.delete(deleteStart, deleteLength);
    if (insert.length > 0) ytext.insert(deleteStart, insert);
  };
  const doc = ytext.doc;
  if (doc) {
    doc.transact(apply, origin);
  } else {
    // Standalone text (unit tests without a doc): implicit transactions.
    apply();
  }
}
