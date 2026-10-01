import type * as Y from 'yjs';

const isHigh = (c: number) => c >= 0xd800 && c <= 0xdbff;
const isLow = (c: number) => c >= 0xdc00 && c <= 0xdfff;

export function clampToLimit(next: string, max: number): string {
  if (next.length <= max) return next;
  let end = max;
  if (end > 0 && isHigh(next.charCodeAt(end - 1))) end -= 1; // never split a surrogate pair
  return next.slice(0, end);
}

/** Minimal edit: common prefix and suffix are kept, only the middle is deleted/inserted. */
export function applyTextDiff(ytext: Y.Text, next: string, origin: unknown): void {
  const cur = ytext.toString();
  if (cur === next) return;
  let prefix = 0;
  const maxPrefix = Math.min(cur.length, next.length);
  while (prefix < maxPrefix && cur.charCodeAt(prefix) === next.charCodeAt(prefix)) prefix++;
  if (prefix > 0 && isHigh(cur.charCodeAt(prefix - 1))) prefix--;
  let suffix = 0;
  const maxSuffix = Math.min(cur.length, next.length) - prefix;
  while (suffix < maxSuffix
    && cur.charCodeAt(cur.length - 1 - suffix) === next.charCodeAt(next.length - 1 - suffix)) suffix++;
  if (suffix > 0 && isLow(cur.charCodeAt(cur.length - suffix))) suffix--;
  const del = cur.length - prefix - suffix;
  const ins = next.slice(prefix, next.length - suffix);
  const run = () => {
    if (del > 0) ytext.delete(prefix, del);
    if (ins.length > 0) ytext.insert(prefix, ins);
  };
  if (ytext.doc) ytext.doc.transact(run, origin);
  else run();
}
