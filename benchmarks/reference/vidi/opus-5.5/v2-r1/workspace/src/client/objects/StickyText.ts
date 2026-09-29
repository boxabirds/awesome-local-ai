import type * as Y from 'yjs';
import {
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_TEXT_MAX_CHARS,
} from '../../shared/config';

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

/** Largest cut index <= `index` that does not split a surrogate pair. */
function safeCut(text: string, index: number): number {
  return index > 0 && index < text.length && isLowSurrogate(text.charCodeAt(index))
    ? index - 1
    : index;
}

/** Keeps at most `max` characters (never splitting a surrogate pair). */
export function clampToLimit(next: string, max: number = STICKY_TEXT_MAX_CHARS): string {
  if (next.length <= max) return next;
  return next.slice(0, safeCut(next, max));
}

/** Length of the common prefix and suffix of two strings, never splitting surrogate pairs. */
function commonEnds(prev: string, next: string) {
  const limit = Math.min(prev.length, next.length);
  let prefix = 0;
  while (prefix < limit && prev.charCodeAt(prefix) === next.charCodeAt(prefix)) prefix++;
  if (prefix > 0 && isHighSurrogate(prev.charCodeAt(prefix - 1))) prefix--;
  let suffix = 0;
  while (
    suffix < limit - prefix &&
    prev.charCodeAt(prev.length - 1 - suffix) === next.charCodeAt(next.length - 1 - suffix)
  ) {
    suffix++;
  }
  if (suffix > 0 && isLowSurrogate(next.charCodeAt(next.length - suffix))) suffix--;
  return { prefix, suffix };
}

/**
 * Limits an edit from `prev` to `next` to `max` characters by dropping the part of the
 * inserted text that does not fit, so existing text is never lost. `caret` is the position
 * just after the kept inserted text.
 */
export function clampEdit(
  prev: string,
  next: string,
  max: number = STICKY_TEXT_MAX_CHARS,
): { text: string; caret: number } {
  const { prefix, suffix } = commonEnds(prev, next);
  if (next.length <= max) return { text: next, caret: next.length - suffix };
  const inserted = next.slice(prefix, next.length - suffix);
  const room = max - prefix - suffix;
  if (room < 0) {
    const text = clampToLimit(next, max);
    return { text, caret: text.length };
  }
  const kept = inserted.slice(0, safeCut(inserted, room));
  return {
    text: next.slice(0, prefix) + kept + next.slice(next.length - suffix),
    caret: prefix + kept.length,
  };
}

/** Writes the minimal change (one delete and/or one insert) turning `ytext` into `next`. */
export function applyTextDiff(ytext: Y.Text, next: string, origin: unknown): void {
  const prev = ytext.toString();
  if (prev === next) return;
  const { prefix, suffix } = commonEnds(prev, next);
  const deleteCount = prev.length - prefix - suffix;
  const insert = next.slice(prefix, next.length - suffix);
  const apply = () => {
    if (deleteCount > 0) ytext.delete(prefix, deleteCount);
    if (insert.length > 0) ytext.insert(prefix, insert);
  };
  if (ytext.doc) ytext.doc.transact(apply, origin);
  else apply();
}

/** One Yjs text delta (`Y.YTextEvent.delta`). */
export type TextDelta = ReadonlyArray<{ insert?: unknown; retain?: number; delete?: number }>;

/**
 * Maps an index (e.g. a caret) in the text before `delta` to the same place in the text after
 * it. Text inserted exactly at `index` ends up after it: the index does not move past it.
 */
export function transformIndex(index: number, delta: TextDelta): number {
  let oldPos = 0;
  let result = index;
  for (const op of delta) {
    if (op.retain !== undefined) {
      oldPos += op.retain;
    } else if (op.insert !== undefined) {
      if (oldPos < index) result += typeof op.insert === 'string' ? op.insert.length : 1;
    } else if (op.delete !== undefined) {
      if (index > oldPos) result -= Math.min(op.delete, index - oldPos);
      oldPos += op.delete;
    }
    if (oldPos >= index && op.insert === undefined) break;
  }
  return result;
}

/**
 * Writes the local edit `base` → `next` to `ytext` when `ytext` has meanwhile received the
 * remote changes `remote` (in order) on top of `base`. Remote text is kept. Returns the caret
 * position just after the local insert.
 */
export function applyTextEditOver(
  ytext: Y.Text,
  base: string,
  next: string,
  remote: readonly TextDelta[],
  origin: unknown,
): number {
  const { prefix, suffix } = commonEnds(base, next);
  let start = prefix;
  let end = base.length - suffix;
  for (const delta of remote) {
    start = transformIndex(start, delta);
    end = Math.max(start, transformIndex(end, delta));
  }
  const insert = next.slice(prefix, next.length - suffix);
  const apply = () => {
    if (end > start) ytext.delete(start, end - start);
    if (insert.length > 0) ytext.insert(start, insert);
  };
  if (ytext.doc) ytext.doc.transact(apply, origin);
  else apply();
  return start + insert.length;
}

/** True when the character counter should show (remaining <= STICKY_COUNTER_THRESHOLD_CHARS). */
export function counterVisible(length: number): boolean {
  return STICKY_TEXT_MAX_CHARS - length <= STICKY_COUNTER_THRESHOLD_CHARS;
}

/**
 * Finds the largest integer font size in [STICKY_FONT_MIN_PX, STICKY_FONT_MAX_PX] at which
 * `el` (text including its padding) is no taller than `box`. Leaves that size applied to `el`.
 */
export function fitFontSize(el: HTMLElement, box: number): { fontPx: number; overflow: boolean } {
  const fits = (px: number) => {
    el.style.fontSize = `${px}px`;
    return el.scrollHeight <= box;
  };
  if (fits(STICKY_FONT_MAX_PX)) return { fontPx: STICKY_FONT_MAX_PX, overflow: false };
  if (!fits(STICKY_FONT_MIN_PX)) return { fontPx: STICKY_FONT_MIN_PX, overflow: true };
  let lo = STICKY_FONT_MIN_PX; // fits
  let hi = STICKY_FONT_MAX_PX; // does not fit
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (fits(mid)) lo = mid;
    else hi = mid;
  }
  el.style.fontSize = `${lo}px`;
  return { fontPx: lo, overflow: false };
}
