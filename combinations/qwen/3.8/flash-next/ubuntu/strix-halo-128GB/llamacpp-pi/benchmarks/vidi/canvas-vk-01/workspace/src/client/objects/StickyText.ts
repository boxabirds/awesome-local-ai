import {
  STICKY_TEXT_MAX_CHARS,
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_FONT_MIN_PX,
  STICKY_FONT_MAX_PX,
} from '../../shared/config';
import { clampToLimit as clampShared } from '../../shared/text-edit';

/**
 * Sticky text logic: clamp, diff, counter visibility, and font fitting.
 *
 * Story 9 moved the clamp and the diff to `shared/text-edit.ts` so text
 * objects edit exactly like notes; the sticky-flavoured re-exports stay here
 * (the clamp's max defaults to STICKY_TEXT_MAX_CHARS).
 */

export { applyTextDiff } from '../../shared/text-edit';

export function clampToLimit(next: string, max: number = STICKY_TEXT_MAX_CHARS): string {
  return clampShared(next, max);
}

/** Where the caret sits in a textarea. */
export interface Selection {
  start: number;
  end: number;
}

/**
 * Fold a remote change of the same text (`before` → `after`) into the value the
 * local user is editing, keeping their edit and moving the caret out of the way
 * of the remote insert.
 *
 * The remote change is taken as one splice — the common prefix and suffix of the
 * two remote versions bracket what changed — and applied at the same offsets of
 * the local value. Two people typing in different places therefore keep both
 * edits; two people editing the very same characters end up with whichever one
 * the document kept, which is what the merge decided anyway.
 */
export function mergeRemoteText(
  local: string,
  before: string,
  after: string,
  selection: Selection,
): { value: string; selection: Selection } {
  if (before === after) return { value: local, selection };

  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < before.length - prefix &&
    suffix < after.length - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  const deleted = before.length - prefix - suffix;
  const inserted = after.slice(prefix, after.length - suffix);
  const value =
    local.slice(0, Math.min(prefix, local.length)) +
    inserted +
    local.slice(Math.min(prefix + deleted, local.length));
  const shift = (position: number): number => {
    if (position <= prefix) return position;
    if (position >= prefix + deleted) return position + inserted.length - deleted;
    return prefix + inserted.length;
  };
  return {
    value,
    selection: { start: shift(selection.start), end: shift(selection.end) },
  };
}

/** Returns true when the character counter should be visible (remaining <= threshold). */
export function counterVisible(length: number): boolean {
  const remaining = STICKY_TEXT_MAX_CHARS - length;
  return remaining <= STICKY_COUNTER_THRESHOLD_CHARS;
}

/**
 * Binary-search the largest integer font size in [STICKY_FONT_MIN_PX, STICKY_FONT_MAX_PX]
 * such that el.scrollHeight <= box. Returns overflow=true if even the smallest size doesn't fit.
 */
export function fitFontSize(el: HTMLElement, box: number): { fontPx: number; overflow: boolean } {
  const min = STICKY_FONT_MIN_PX;
  const max = STICKY_FONT_MAX_PX;

  // Try max first
  el.style.fontSize = `${max}px`;
  if (el.scrollHeight <= box) {
    return { fontPx: max, overflow: false };
  }

  // Try min
  el.style.fontSize = `${min}px`;
  if (el.scrollHeight <= box) {
    // Binary search between min and max for the largest fitting size
    let lo = min;
    let hi = max;
    while (lo < hi - 1) {
      const mid = Math.floor((lo + hi) / 2);
      el.style.fontSize = `${mid}px`;
      if (el.scrollHeight <= box) {
        lo = mid;
      } else {
        hi = mid;
      }
    }
    el.style.fontSize = `${lo}px`;
    return { fontPx: lo, overflow: false };
  }

  // Even min doesn't fit
  el.style.fontSize = `${min}px`;
  return { fontPx: min, overflow: true };
}
