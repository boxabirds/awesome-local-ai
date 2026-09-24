/**
 * Pure sticky-note text logic: length limit, counter rule, minimal Y.Text diff and font fit.
 */
import type * as Y from 'yjs';
import {
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_TEXT_MAX_CHARS,
} from '../../shared/config';

const HIGH_SURROGATE_MIN = 0xd800;
const HIGH_SURROGATE_MAX = 0xdbff;
const LOW_SURROGATE_MIN = 0xdc00;
const LOW_SURROGATE_MAX = 0xdfff;
const HALF = 2;

function isHighSurrogate(code: number): boolean {
  return code >= HIGH_SURROGATE_MIN && code <= HIGH_SURROGATE_MAX;
}

function isLowSurrogate(code: number): boolean {
  return code >= LOW_SURROGATE_MIN && code <= LOW_SURROGATE_MAX;
}

/** Cuts `next` to at most `max` UTF-16 code units without splitting a surrogate pair. */
export function clampToLimit(next: string, max: number = STICKY_TEXT_MAX_CHARS): string {
  if (next.length <= max) return next;
  let end = max;
  if (end > 0 && isHighSurrogate(next.charCodeAt(end - 1))) end -= 1;
  return next.slice(0, end);
}

/** True when the character counter should show: remaining <= STICKY_COUNTER_THRESHOLD_CHARS. */
export function counterVisible(length: number): boolean {
  return STICKY_TEXT_MAX_CHARS - length <= STICKY_COUNTER_THRESHOLD_CHARS;
}

/**
 * Writes `next` into `ytext` as one delete and/or one insert between the common prefix and
 * common suffix, in one transaction. A full replace would destroy other people's concurrent
 * typing once edits are shared (story 3). Does nothing when the text is unchanged or the
 * Y.Text has been removed from its document (note deleted meanwhile).
 */
export function applyTextDiff(ytext: Y.Text, next: string, origin: unknown): void {
  const doc = ytext.doc;
  if (!doc || ytext._item?.deleted) return;
  const prev = ytext.toString();
  if (prev === next) return;

  const maxCommon = Math.min(prev.length, next.length);
  let prefix = 0;
  while (prefix < maxCommon && prev.charCodeAt(prefix) === next.charCodeAt(prefix)) prefix += 1;
  // Never split a surrogate pair: back off if the prefix ends on a high surrogate.
  if (prefix > 0 && isHighSurrogate(prev.charCodeAt(prefix - 1))) prefix -= 1;

  let suffix = 0;
  const maxSuffix = maxCommon - prefix;
  while (
    suffix < maxSuffix &&
    prev.charCodeAt(prev.length - 1 - suffix) === next.charCodeAt(next.length - 1 - suffix)
  ) {
    suffix += 1;
  }
  // ...or if the suffix starts on a low surrogate.
  if (suffix > 0 && isLowSurrogate(prev.charCodeAt(prev.length - suffix))) suffix -= 1;

  const deleteCount = prev.length - prefix - suffix;
  const insert = next.slice(prefix, next.length - suffix);
  doc.transact(() => {
    if (deleteCount > 0) ytext.delete(prefix, deleteCount);
    if (insert.length > 0) ytext.insert(prefix, insert);
  }, origin);
}

/**
 * Finds the largest integer font size in [STICKY_FONT_MIN_PX, STICKY_FONT_MAX_PX] at which
 * `el`'s content fits in `box` px of height (`scrollHeight <= box`), by binary search over
 * real layout. Leaves `el.style.fontSize` at the result. `overflow` is true when even the
 * minimum size does not fit.
 */
export function fitFontSize(el: HTMLElement, box: number): { fontPx: number; overflow: boolean } {
  const fits = (px: number) => {
    el.style.fontSize = `${px}px`;
    return el.scrollHeight <= box;
  };
  if (fits(STICKY_FONT_MAX_PX)) return { fontPx: STICKY_FONT_MAX_PX, overflow: false };
  if (!fits(STICKY_FONT_MIN_PX)) return { fontPx: STICKY_FONT_MIN_PX, overflow: true };
  // Invariant: lo fits, hi does not.
  let lo = STICKY_FONT_MIN_PX;
  let hi = STICKY_FONT_MAX_PX;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / HALF);
    if (fits(mid)) lo = mid;
    else hi = mid;
  }
  el.style.fontSize = `${lo}px`;
  return { fontPx: lo, overflow: false };
}

/** One Yjs text delta operation (as in `YTextEvent.delta`). */
export interface TextDeltaOp {
  insert?: string | object;
  retain?: number;
  delete?: number;
}

/**
 * Maps a caret index in the text before a change to the same place after it. Insertions
 * exactly at the caret land after it (the caret stays before them), so the person typing
 * keeps typing where they were while someone else's words appear next to theirs.
 */
export function transformIndex(index: number, delta: readonly TextDeltaOp[]): number {
  let oldPos = 0;
  let result = index;
  for (const op of delta) {
    if (op.retain !== undefined) {
      oldPos += op.retain;
    } else if (op.insert !== undefined) {
      const length = typeof op.insert === 'string' ? op.insert.length : 1;
      if (oldPos < index) result += length;
    } else if (op.delete !== undefined) {
      result -= Math.min(Math.max(index - oldPos, 0), op.delete);
      oldPos += op.delete;
    }
  }
  return result;
}
