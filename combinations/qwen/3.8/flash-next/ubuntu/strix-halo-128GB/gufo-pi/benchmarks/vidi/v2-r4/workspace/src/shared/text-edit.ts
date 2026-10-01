/**
 * Shared text-edit helpers: clampToLimit and applyTextDiff.
 *
 * Moved from `StickyText.ts` (story 2) so both sticky notes and text objects
 * share the same logic. `StickyText.ts` re-exports with STICKY_TEXT_MAX_CHARS
 * for backward compatibility.
 */
import type * as Y from 'yjs';

/** Keep at most `max` characters, never cutting a surrogate pair in half. */
export function clampToLimit(next: string, max: number): string {
  if (next.length <= max) return next;
  let cut = max;
  // If the character just before the cut is a high surrogate, its pair would
  // be split; drop it.
  const code = next.charCodeAt(cut - 1);
  if (code >= 0xd800 && code <= 0xdbff) cut -= 1;
  return next.slice(0, cut);
}

/**
 * Write `next` into `ytext` with the minimal change: one delete and/or one
 * insert of the region between the common prefix and the common suffix. A full
 * replace would destroy concurrent typing (story 3), so the diff matters.
 *
 * The diff runs on Unicode code points, so a surrogate pair is never cut in
 * half by the shared prefix/suffix boundary.
 */
export function applyTextDiff(ytext: Y.Text, next: string, origin: unknown): void {
  const current = ytext.toString();
  if (current === next) return;
  const before = Array.from(current);
  const after = Array.from(next);

  let prefix = 0;
  const maxPrefix = Math.min(before.length, after.length);
  while (prefix < maxPrefix && before[prefix] === after[prefix]) prefix += 1;

  let suffix = 0;
  const maxSuffix = maxPrefix - prefix;
  while (
    suffix < maxSuffix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  const inserted = after.slice(prefix, after.length - suffix).join('');
  // Code-point index -> UTF-16 offset (Yjs indexes are UTF-16 code units).
  const offset = before.slice(0, prefix).join('').length;
  const removedUnits = before.slice(prefix, before.length - suffix).join('').length;

  const doc = ytext.doc;
  const apply = () => {
    if (removedUnits > 0) ytext.delete(offset, removedUnits);
    if (inserted.length > 0) ytext.insert(offset, inserted);
  };
  if (doc) doc.transact(apply, origin);
  else apply();
}
