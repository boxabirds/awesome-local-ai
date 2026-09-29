/**
 * Text editing helpers shared by the sticky editor (story 2) and free text
 * (story 9). Both types clamp incoming input to a character limit and write to
 * their Y.Text with a minimal diff, so the two stay in lockstep (design §11).
 * Framework-free and DOM-free: the same code can run in the Durable Object.
 */

import * as Y from 'yjs';

/** Clamp an incoming value to `max` characters. Never grows the string. */
export function clampToLimit(next: string, max: number): string {
  return next.length <= max ? next : next.slice(0, max);
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}
function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

/**
 * Write `next` into `ytext` with the minimal change: a common prefix and a
 * common suffix are left untouched, and only the differing middle is replaced
 * (one delete and/or one insert, inside a single transaction). A full replace
 * would destroy concurrent typing once the board syncs, so the diff is
 * required, not just an optimisation.
 *
 * Surrogate pairs are kept intact: the cut points are widened so a delete never
 * splits a pair, and a lone low surrogate is never emitted as a replacement.
 *
 * `origin` is the transaction origin (`LOCAL_ORIGIN` for a local edit) — it is
 * what lets the undo manager and the remote-echo guard tell the two apart.
 */
export function applyTextDiff(ytext: Y.Text, next: string, origin: unknown): void {
  const current = ytext.toString();
  if (current === next) return;
  const doc = ytext.doc;

  const run = () => {
    // Longest common prefix.
    let start = 0;
    const minLen = Math.min(current.length, next.length);
    while (start < minLen && current.charCodeAt(start) === next.charCodeAt(start)) start += 1;

    // Longest common suffix, not overlapping the prefix.
    let endCur = current.length;
    let endNext = next.length;
    while (endCur > start && endNext > start && current.charCodeAt(endCur - 1) === next.charCodeAt(endNext - 1)) {
      endCur -= 1;
      endNext -= 1;
    }

    // Do not split a surrogate pair at either cut point.
    if (start < current.length && isLowSurrogate(current.charCodeAt(start)) && start > 0) start -= 1;
    if (endCur < current.length && isHighSurrogate(current.charCodeAt(endCur - 1)) && endCur >= 2) endCur += 1;

    const deleteLen = endCur - start;
    const inserted = next.slice(start, endNext);
    // Never emit an orphan low surrogate at the start of the inserted run: it
    // would render as a replacement character.
    const cleanInserted =
      inserted.length > 0 && isLowSurrogate(inserted.charCodeAt(0)) && !isHighSurrogate(inserted.charCodeAt(1) ?? 0)
        ? inserted.slice(1)
        : inserted;

    if (deleteLen > 0) ytext.delete(start, deleteLen);
    if (cleanInserted.length > 0) ytext.insert(start, cleanInserted);
  };

  if (doc) doc.transact(run, origin);
  else run();
}
