/**
 * Shared text editing helpers used by both sticky notes and text objects.
 * clampToLimit and applyTextDiff are extracted here so both types share them.
 */
import type * as Y from 'yjs';

/**
 * Keeps at most `max` characters. A surrogate pair that would straddle the
 * limit is dropped whole, so the kept text never contains a lone surrogate.
 */
export function clampToLimit(next: string, max: number): string {
  if (next.length <= max) return next;
  let kept = '';
  for (const char of next) {
    if (kept.length + char.length > max) break;
    kept += char;
  }
  return kept;
}

/**
 * Writes `next` into `ytext` using the minimal change (common prefix and
 * suffix), so a concurrent typist is never overwritten by a full replace.
 */
export function applyTextDiff(ytext: Y.Text, next: string, origin: unknown): void {
  const currentCps = Array.from(ytext.toString());
  const nextCps = Array.from(next);

  let start = 0;
  while (
    start < currentCps.length &&
    start < nextCps.length &&
    currentCps[start] === nextCps[start]
  ) {
    start += 1;
  }

  let currentEnd = currentCps.length;
  let nextEnd = nextCps.length;
  while (
    currentEnd > start &&
    nextEnd > start &&
    currentCps[currentEnd - 1] === nextCps[nextEnd - 1]
  ) {
    currentEnd -= 1;
    nextEnd -= 1;
  }

  const deleteFrom = unitOffset(currentCps, start);
  const deleteTo = unitOffset(currentCps, currentEnd);
  const deleteCount = deleteTo - deleteFrom;
  const insertText = nextCps.slice(start, nextEnd).join('');

  if (deleteCount === 0 && insertText === '') return;

  const apply = () => {
    if (deleteCount > 0) ytext.delete(deleteFrom, deleteCount);
    if (insertText !== '') ytext.insert(deleteFrom, insertText);
  };

  if (ytext.doc) ytext.doc.transact(apply, origin);
  else apply();
}

/** UTF-16 offset of the code point at `index`. */
function unitOffset(cps: string[], index: number): number {
  let offset = 0;
  for (let i = 0; i < index; i += 1) offset += cps[i].length;
  return offset;
}
