import * as Y from 'yjs';

/**
 * Shared text-editing helpers (story 9). `clampToLimit` and `applyTextDiff`
 * are used by both sticky notes (story 2) and free text (story 9).
 */

/** Keeps at most `max` characters. */
export function clampToLimit(next: string, max: number): string {
  return next.length > max ? next.slice(0, max) : next;
}

/**
 * Updates `ytext` to `next` with the minimal change: common prefix + common
 * suffix computed in code points, so at most one delete and one insert inside
 * one transaction. Boundaries always land on code-point boundaries, so emoji
 * surrogate pairs are never split. Required (not a full replace) so concurrent
 * typing by others (story 3) is never destroyed.
 */
export function applyTextDiff(ytext: Y.Text, next: string, origin: unknown): void {
  const current = ytext.toString();
  if (current === next) return;

  const cur = [...current];
  const nxt = [...next];
  const minCp = Math.min(cur.length, nxt.length);

  let prefixCp = 0;
  while (prefixCp < minCp && cur[prefixCp] === nxt[prefixCp]) prefixCp++;
  let suffixCp = 0;
  while (
    suffixCp < minCp - prefixCp &&
    cur[cur.length - 1 - suffixCp] === nxt[nxt.length - 1 - suffixCp]
  ) {
    suffixCp++;
  }

  // Code-unit indices of the (code-point aligned) boundaries.
  const prefixIdx = cur.slice(0, prefixCp).join('').length;
  const suffixIdx = suffixCp === 0 ? 0 : cur.slice(cur.length - suffixCp).join('').length;

  const delLen = current.length - prefixIdx - suffixIdx;
  const ins = next.slice(prefixIdx, next.length - suffixIdx);

  const doc = ytext.doc;
  doc!.transact(() => {
    if (delLen > 0) ytext.delete(prefixIdx, delLen);
    if (ins.length > 0) ytext.insert(prefixIdx, ins);
  }, origin);
}
