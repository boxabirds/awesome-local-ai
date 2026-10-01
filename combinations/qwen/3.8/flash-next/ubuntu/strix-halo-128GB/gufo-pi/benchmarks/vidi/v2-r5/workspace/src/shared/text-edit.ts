import * as Y from 'yjs';

/**
 * Shared text editing helpers used by both sticky notes (story 2) and text objects (story 9).
 * `StickyText.ts` re-exports these with its own default max so story 2 callers are unchanged.
 */

const HIGH_SURROGATE_START = 0xd800;
const HIGH_SURROGATE_END = 0xdbff;

/** Keep at most `max` characters; anything beyond the limit is dropped (never half a pair). */
export function clampToLimit(next: string, max: number): string {
  if (!(max >= 0)) return '';
  if (next.length <= max) return next;
  let cut = max;
  const last = next.charCodeAt(cut - 1);
  // A cut between a high and a low surrogate would create a lone surrogate: cut earlier.
  if (last >= HIGH_SURROGATE_START && last <= HIGH_SURROGATE_END) cut -= 1;
  return next.slice(0, cut);
}

/**
 * Write `next` into `ytext` with the minimal change: the common prefix and the common suffix
 * are left alone, so only the edited span is replaced. This is what keeps another user's
 * concurrent typing intact — a full rewrite would delete their characters.
 */
export function applyTextDiff(ytext: Y.Text, nextRaw: string, origin: unknown, max: number): void {
  const next = clampToLimit(nextRaw, max);
  const current = ytext.toString();
  if (current === next) return;

  // Code-point arrays: an index into them can never land inside a surrogate pair.
  const before = Array.from(current);
  const after = Array.from(next);

  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) {
    start += 1;
  }

  let endBefore = before.length;
  let endAfter = after.length;
  while (
    endBefore > start &&
    endAfter > start &&
    before[endBefore - 1] === after[endAfter - 1]
  ) {
    endBefore -= 1;
    endAfter -= 1;
  }

  const unitLength = (codePoints: string[]): number =>
    codePoints.reduce((total, point) => total + point.length, 0);

  const utf16Start = unitLength(before.slice(0, start));
  const deleteCount = unitLength(before.slice(start, endBefore));
  const insertText = after.slice(start, endAfter).join('');

  ytext.doc?.transact(() => {
    if (deleteCount > 0) ytext.delete(utf16Start, deleteCount);
    if (insertText.length > 0) ytext.insert(utf16Start, insertText);
  }, origin);
}
