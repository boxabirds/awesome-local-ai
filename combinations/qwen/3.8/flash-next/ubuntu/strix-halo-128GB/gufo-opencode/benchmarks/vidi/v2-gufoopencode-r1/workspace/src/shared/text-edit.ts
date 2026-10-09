import * as Y from 'yjs';

// Shared text-editing helpers used by every editable object type (story 2
// sticky notes, story 9 text objects). Each object module passes its own max.

export function clampToLimit(next: string, max: number): string {
  return next.length > max ? next.slice(0, max) : next;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

// Moves an index left so it never sits between the two code units of a
// surrogate pair.
function safeIndex(s: string, i: number): number {
  if (i > 0 && i < s.length && isLowSurrogate(s.charCodeAt(i))) return i - 1;
  return i;
}

export function applyTextDiff(ytext: Y.Text, next: string, origin: unknown): void {
  const current = ytext.toString();
  if (current === next) return;
  const doc = ytext.doc;
  const apply = (): void => {
    const maxCommon = Math.min(current.length, next.length);
    let start = 0;
    while (start < maxCommon && current[start] === next[start]) start += 1;
    let endCurrent = current.length;
    let endNext = next.length;
    while (endCurrent > start && endNext > start && current[endCurrent - 1] === next[endNext - 1]) {
      endCurrent -= 1;
      endNext -= 1;
    }
    const from = safeIndex(current, safeIndex(next, start));
    const deleteLength = endCurrent - from;
    const inserted = next.slice(from, endNext);
    if (deleteLength > 0) ytext.delete(from, deleteLength);
    if (inserted.length > 0) ytext.insert(from, inserted);
  };
  if (doc !== null) doc.transact(apply, origin);
  else apply();
}
