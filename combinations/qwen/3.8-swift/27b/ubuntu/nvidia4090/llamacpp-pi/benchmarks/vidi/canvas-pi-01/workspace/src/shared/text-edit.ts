// Shared Y.Text editing helpers (see spec: text.model / sticky.text).
//
// `clampToLimit` enforces a per-type character budget (surrogate-pair safe);
// `applyTextDiff` brings a Y.Text to a target string with the minimal change
// (common prefix + common suffix → at most one delete and one insert), so
// concurrent typing from other clients is preserved.

import * as Y from 'yjs';

function isTrailingSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

/** Keep at most `max` characters; a lone trailing surrogate is never kept. */
export function clampToLimit(next: string, max: number): string {
  if (next.length <= max) return next;
  let cut = next.slice(0, max);
  // Never leave a lone trailing surrogate at the end of the kept text.
  if (cut.length > 0 && isTrailingSurrogate(cut.charCodeAt(cut.length - 1))) {
    cut = cut.slice(0, cut.length - 1);
  }
  return cut;
}

/**
 * Bring `ytext` to `next` with the minimal change: common prefix + common
 * suffix, so at most one delete and one insert in a single transaction. A
 * full replace would destroy concurrent typing once sync ships.
 */
export function applyTextDiff(ytext: Y.Text, next: string, origin: unknown): void {
  const current = ytext.toString();
  if (current === next) return;
  const minLen = Math.min(current.length, next.length);
  let p = 0;
  while (p < minLen && current.charCodeAt(p) === next.charCodeAt(p)) p += 1;
  // Do not cut the diff inside a surrogate pair.
  if (p > 0 && isTrailingSurrogate(current.charCodeAt(p - 1))) p -= 1;
  let s = 0;
  while (s < minLen - p && current.charCodeAt(current.length - 1 - s) === next.charCodeAt(next.length - 1 - s)) {
    s += 1;
  }
  if (s > 0 && isTrailingSurrogate(current.charCodeAt(current.length - s))) s -= 1;
  const del = current.length - p - s;
  const ins = next.slice(p, next.length - s);
  if (del === 0 && ins.length === 0) return;
  const apply = () => {
    if (del > 0) ytext.delete(p, del);
    if (ins.length > 0) ytext.insert(p, ins);
  };
  const ydoc = ytext.doc;
  if (ydoc === null) {
    // Standalone Y.Text (unit tests): apply without a transaction.
    apply();
  } else {
    ydoc.transact(apply, origin);
  }
}
