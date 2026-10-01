import type * as Y from 'yjs';

function isHigh(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}
function isLow(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

/** Keeps at most `max` UTF-16 units without cutting a surrogate pair in half. */
export function clampToLimit(next: string, max: number): string {
  if (next.length <= max) return next;
  let end = max;
  if (end > 0 && isHigh(next.charCodeAt(end - 1))) end -= 1;
  return next.slice(0, end);
}

/** Applies the smallest single delete and/or insert that turns the Y.Text into `next`. */
export function applyTextDiff(ytext: Y.Text, next: string, origin: unknown): void {
  const prev = ytext.toString();
  if (prev === next) return;
  const max = Math.min(prev.length, next.length);
  let prefix = 0;
  while (prefix < max && prev.charCodeAt(prefix) === next.charCodeAt(prefix)) prefix++;
  if (prefix > 0 && isHigh(prev.charCodeAt(prefix - 1))) prefix--;
  let suffix = 0;
  while (
    suffix < max - prefix &&
    prev.charCodeAt(prev.length - 1 - suffix) === next.charCodeAt(next.length - 1 - suffix)
  )
    suffix++;
  if (suffix > 0 && isLow(prev.charCodeAt(prev.length - suffix))) suffix--;
  const removeCount = prev.length - prefix - suffix;
  const insert = next.slice(prefix, next.length - suffix);
  const apply = () => {
    if (removeCount > 0) ytext.delete(prefix, removeCount);
    if (insert.length > 0) ytext.insert(prefix, insert);
  };
  if (ytext.doc) ytext.doc.transact(apply, origin);
  else apply();
}
