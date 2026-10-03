import type * as Y from 'yjs';

import {
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_TEXT_MAX_CHARS,
} from '../../shared/config';

/**
 * Pure text helpers for sticky notes: length clamping, minimal Y.Text diffing,
 * the counter visibility rule and font auto-fit. Kept free of React so the diff
 * and clamp logic is unit-testable against a real Y.Text.
 */

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

/** Keep at most `max` characters (default STICKY_TEXT_MAX_CHARS). */
export function clampToLimit(next: string, max: number = STICKY_TEXT_MAX_CHARS): string {
  return next.length <= max ? next : next.slice(0, max);
}

/**
 * Update `ytext` from its current string to `next` with the minimal
 * delete-and/or-insert (common prefix + common suffix), inside one transaction.
 * A minimal diff (not replace-all) means concurrent typing by others (story 3)
 * is never destroyed. Surrogate-pair safe: boundaries never split an emoji.
 */
export function applyTextDiff(ytext: Y.Text, next: string, origin: unknown): void {
  const current = ytext.toString();
  if (current === next) return;

  // Common prefix.
  const maxPrefix = Math.min(current.length, next.length);
  let prefix = 0;
  while (prefix < maxPrefix && current[prefix] === next[prefix]) prefix += 1;
  // Back the prefix off a split surrogate pair (the two strings share it).
  if (
    prefix > 0 &&
    prefix < current.length &&
    isHighSurrogate(current.charCodeAt(prefix - 1)) &&
    isLowSurrogate(current.charCodeAt(prefix))
  ) {
    prefix -= 1;
  }

  // Common suffix (bounded so it cannot overlap the prefix).
  const maxSuffix = Math.min(current.length, next.length) - prefix;
  let suffix = 0;
  while (
    suffix < maxSuffix &&
    current[current.length - 1 - suffix] === next[next.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  // Back the suffix off a split surrogate pair in either string.
  const cutCurrent = current.length - suffix;
  if (
    suffix > 0 &&
    cutCurrent > 0 &&
    isLowSurrogate(current.charCodeAt(cutCurrent)) &&
    isHighSurrogate(current.charCodeAt(cutCurrent - 1))
  ) {
    suffix -= 1;
  }
  const cutNext = next.length - suffix;
  if (
    suffix > 0 &&
    cutNext > 0 &&
    isLowSurrogate(next.charCodeAt(cutNext)) &&
    isHighSurrogate(next.charCodeAt(cutNext - 1))
  ) {
    suffix -= 1;
  }

  const deleteLength = current.length - prefix - suffix;
  const inserted = next.slice(prefix, next.length - suffix);

  const run = () => {
    if (deleteLength > 0) ytext.delete(prefix, deleteLength);
    if (inserted.length > 0) ytext.insert(prefix, inserted);
  };
  const doc = ytext.doc;
  if (doc) doc.transact(run, origin);
  else run();
}

/**
 * True when the remaining character budget is within
 * STICKY_COUNTER_THRESHOLD_CHARS (i.e. the counter should be shown).
 */
export function counterVisible(length: number): boolean {
  return STICKY_TEXT_MAX_CHARS - length <= STICKY_COUNTER_THRESHOLD_CHARS;
}

export interface FontFit {
  fontPx: number;
  overflow: boolean;
}

/**
 * Largest integer font size in [STICKY_FONT_MIN_PX, STICKY_FONT_MAX_PX] at
 * which the element's content fits within `box` (its content box, px). Applied
 * to `el.style.fontSize`. When it does not fit even at the minimum, `overflow`
 * is true (the caller clips and fades). Monotonic in size, so a binary search
 * finds the largest that fits.
 */
export function fitFontSize(el: HTMLElement, box: number): FontFit {
  let low = STICKY_FONT_MIN_PX;
  let high = STICKY_FONT_MAX_PX;
  let best = STICKY_FONT_MIN_PX;
  let anyFits = false;

  while (low <= high) {
    const mid = (low + high) >> 1;
    el.style.fontSize = `${mid}px`;
    if (el.scrollHeight <= box) {
      best = mid;
      anyFits = true;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  el.style.fontSize = `${best}px`;
  return { fontPx: best, overflow: !anyFits || el.scrollHeight > box };
}
