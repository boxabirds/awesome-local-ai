/**
 * Sticky note text logic: the length limit, the minimal diff into a `Y.Text`,
 * the character counter rule and the font auto-fit. Pure apart from the one
 * DOM element `fitFontSize` measures (real layout is only needed there, which
 * is why the fit itself is verified in e2e).
 */

import type * as Y from 'yjs';

import {
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_TEXT_MAX_CHARS,
} from '../../shared/config';

/** Keep at most `max` characters (sticky.text_limit). */
export function clampToLimit(next: string, max: number = STICKY_TEXT_MAX_CHARS): string {
  return next.length <= max ? next : next.slice(0, max);
}

/**
 * True when the character counter should show: remaining characters
 * <= STICKY_COUNTER_THRESHOLD_CHARS (so at 950 of 1,000 it appears).
 */
export function counterVisible(length: number): boolean {
  return STICKY_TEXT_MAX_CHARS - length <= STICKY_COUNTER_THRESHOLD_CHARS;
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

/** True when index `at` in `text` sits between the halves of a surrogate pair. */
function splitsPair(text: string, at: number): boolean {
  if (at <= 0 || at >= text.length) return false;
  return isHighSurrogate(text.charCodeAt(at - 1)) && isLowSurrogate(text.charCodeAt(at));
}

/**
 * Write `next` into `ytext` with the minimal change (common prefix + common
 * suffix): at most one delete and one insert in one transaction. Required so
 * concurrent typing by others (story 3) is never destroyed — a delete-all +
 * insert-all would overwrite what someone else typed a moment ago.
 *
 * Diff boundaries never split a surrogate pair: an emoji is deleted or kept
 * whole (the Yjs positions are UTF-16 code units, like JS string indexes).
 * A no-op edit opens no transaction, so a stale input costs no sync traffic.
 */
export function applyTextDiff(ytext: Y.Text, next: string, origin: unknown): void {
  const current = ytext.toString();
  if (current === next) return;
  const doc = ytext.doc;
  if (!doc) return; // detached text (note deleted mid-edit): write nothing

  const minLen = Math.min(current.length, next.length);
  let prefix = 0;
  while (prefix < minLen && current[prefix] === next[prefix]) prefix += 1;
  if (splitsPair(current, prefix) || splitsPair(next, prefix)) prefix -= 1;

  let suffix = 0;
  while (
    suffix < minLen - prefix &&
    current[current.length - 1 - suffix] === next[next.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  if (suffix > 0 && (splitsPair(current, current.length - suffix) || splitsPair(next, next.length - suffix))) {
    suffix -= 1;
  }

  const deleteLength = current.length - prefix - suffix;
  const insertText = next.slice(prefix, next.length - suffix);

  doc.transact(() => {
    if (deleteLength > 0) ytext.delete(prefix, deleteLength);
    if (insertText.length > 0) ytext.insert(prefix, insertText);
  }, origin);
}

/**
 * Binary-search integer font sizes in [STICKY_FONT_MIN_PX, STICKY_FONT_MAX_PX]
 * (at 100% zoom; the size is in board units so it scales with zoom) for the
 * largest at which the element's text fits `box` pixels, and apply it to
 * `el`. When even the minimum does not fit, `overflow` is true: the caller
 * hides the overflow and fades the bottom edge (sticky.text_fit).
 */
export function fitFontSize(
  el: HTMLElement,
  box: number,
): { fontPx: number; overflow: boolean } {
  const fits = (size: number): boolean => {
    el.style.fontSize = `${size}px`;
    return el.scrollHeight <= box;
  };

  if (fits(STICKY_FONT_MAX_PX)) return { fontPx: STICKY_FONT_MAX_PX, overflow: false };

  if (!fits(STICKY_FONT_MIN_PX)) {
    el.style.fontSize = `${STICKY_FONT_MIN_PX}px`;
    return { fontPx: STICKY_FONT_MIN_PX, overflow: true };
  }

  // `lo` fits, `hi` does not; converge on the largest fitting size.
  let lo = STICKY_FONT_MIN_PX;
  let hi = STICKY_FONT_MAX_PX;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (fits(mid)) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  el.style.fontSize = `${lo}px`;
  return { fontPx: lo, overflow: false };
}
