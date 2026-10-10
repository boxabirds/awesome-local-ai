// Text editing primitives shared by every editable object type (sticky notes,
// free text). Moved out of client/objects/StickyText.ts for story 9 so the
// shared layer can clamp and diff without importing client code.

import * as Y from 'yjs';

export function clampToLimit(next: string, max: number): string {
  return next.length <= max ? next : next.slice(0, max);
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

// Minimal change with common prefix + common suffix, so a concurrent typer
// (story 3) can never be overwritten by a full replace. Boundaries are nudged
// out of surrogate pairs so an emoji is never split into lone surrogates.
export function applyTextDiff(ytext: Y.Text, next: string, origin: unknown): void {
  const prev = ytext.toString();
  if (prev === next) return;

  let p = 0;
  const minLen = Math.min(prev.length, next.length);
  while (p < minLen && prev[p] === next[p]) p++;
  // A prefix must not end between a high surrogate and its low surrogate.
  if (p > 0 && p < prev.length && isLowSurrogate(prev.charCodeAt(p))) p--;

  let s = 0;
  while (
    s < prev.length - p &&
    s < next.length - p &&
    prev[prev.length - 1 - s] === next[next.length - 1 - s]
  ) {
    s++;
  }
  // A suffix must not start between a high surrogate and its low surrogate.
  if (s > 0 && isLowSurrogate(prev.charCodeAt(prev.length - s))) s--;

  const deleteLen = prev.length - p - s;
  const insertText = next.slice(p, next.length - s);

  ytext.doc!.transact(() => {
    if (deleteLen > 0) ytext.delete(p, deleteLen);
    if (insertText.length > 0) ytext.insert(p, insertText);
  }, origin);
}
