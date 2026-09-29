// Shared text-editing primitives: length clamping and the minimal Y.Text diff.
// Both text objects (story 9) and sticky notes (story 2) use these — the design
// `text.edit` moves them out of StickyText.ts so neither type forks the maths.

import type * as Y from 'yjs';

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

/**
 * Keep the first `max` characters; if that boundary would split a surrogate pair,
 * back off one so no lone surrogate is left at the end.
 */
export function clampToLimit(next: string, max: number): string {
  if (next.length <= max) return next;
  let cut = max;
  if (isHighSurrogate(next.charCodeAt(cut - 1))) cut -= 1;
  return next.slice(0, cut);
}

/**
 * Apply the minimal edit (common prefix + common suffix) from `ytext` to `next`
 * inside a single transaction. This is deliberately not a full replace: a full
 * replace would destroy concurrent typing by others.
 */
export function applyTextDiff(ytext: Y.Text, next: string, origin: unknown): void {
  const cur = ytext.toString();
  if (cur === next) return;

  const minLen = Math.min(cur.length, next.length);

  let p = 0;
  while (p < minLen && cur[p] === next[p]) p++;
  // Never split a surrogate pair at the prefix boundary.
  if (p > 0 && isHighSurrogate(next.charCodeAt(p - 1))) p--;

  let s = 0;
  while (
    s < minLen - p &&
    cur[cur.length - 1 - s] === next[next.length - 1 - s]
  ) {
    s++;
  }

  const deleteLen = cur.length - p - s;
  const insertStr = next.slice(p, next.length - s);

  const doc = ytext.doc;
  const run = () => {
    if (deleteLen > 0) ytext.delete(p, deleteLen);
    if (insertStr.length > 0) ytext.insert(p, insertStr);
  };
  if (doc) doc.transact(run, origin);
  else run();
}
