/**
 * Note text logic, kept apart from the component so the interesting parts -
 * the minimal diff, the length limit, the counter rule and the fit search - can
 * be tested without a browser layout.
 *
 * The diff is deliberately minimal (common prefix + common suffix): story 3
 * shares these documents, and a full replace would throw away whatever somebody
 * else typed in the same note a moment ago.
 */

import type * as Y from 'yjs';

import {
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_TEXT_MAX_CHARS,
} from '../../shared/config';

/** Keep at most `max` characters: everything past the limit is dropped. */
export function clampToLimit(next: string, max: number = STICKY_TEXT_MAX_CHARS): string {
  return next.length <= max ? next : next.slice(0, max);
}

/**
 * Whether the character counter should be shown: only when the remaining
 * characters are down to the threshold, so a note being written normally has no
 * counter in the way.
 */
export function counterVisible(length: number): boolean {
  return STICKY_TEXT_MAX_CHARS - length <= STICKY_COUNTER_THRESHOLD_CHARS;
}

/**
 * Write `next` into `ytext` with the smallest change that produces it: one
 * delete and/or one insert, inside a single transaction. A no-op change writes
 * nothing and emits nothing.
 */
export function applyTextDiff(ytext: Y.Text, next: string, origin: unknown): void {
  const before = ytext.toString();
  if (before === next) return;
  const edit = minimalEdit(before, next);
  const apply = (): void => {
    if (edit.deleteLength > 0) ytext.delete(edit.at, edit.deleteLength);
    if (edit.text.length > 0) ytext.insert(edit.at, edit.text);
  };
  // A detached Y.Text (before it is attached to a document) has no
  // transactions; apply the change directly.
  if (ytext.doc === null) apply();
  else ytext.doc.transact(apply, origin);
}

interface MinimalEdit {
  /** Index the change starts at, in UTF-16 units. */
  at: number;
  /** How many characters of the old text are removed. */
  deleteLength: number;
  /** What is inserted at `at`. */
  text: string;
}

/** Common prefix and common suffix, so only the middle is rewritten. */
function minimalEdit(before: string, next: string): MinimalEdit {
  let prefix = 0;
  const maxPrefix = Math.min(before.length, next.length);
  while (prefix < maxPrefix && before.charCodeAt(prefix) === next.charCodeAt(prefix)) {
    prefix += 1;
  }
  // Never end the prefix between the halves of a surrogate pair: the pair is
  // then rewritten as a whole instead of being torn in two.
  if (prefix > 0 && splitsSurrogatePair(before, prefix)) prefix -= 1;

  let suffix = 0;
  const maxSuffix = Math.min(before.length - prefix, next.length - prefix);
  while (
    suffix < maxSuffix &&
    before.charCodeAt(before.length - 1 - suffix) === next.charCodeAt(next.length - 1 - suffix)
  ) {
    suffix += 1;
  }
  if (suffix > 0 && splitsSurrogatePair(before, before.length - suffix)) suffix -= 1;

  return {
    at: prefix,
    deleteLength: before.length - prefix - suffix,
    text: next.slice(prefix, next.length - suffix),
  };
}

/** True when index `at` falls between a high and a low surrogate. */
function splitsSurrogatePair(text: string, at: number): boolean {
  if (at <= 0 || at >= text.length) return false;
  const before = text.charCodeAt(at - 1);
  const after = text.charCodeAt(at);
  const isHighSurrogate = before >= 0xd800 && before <= 0xdbff;
  const isLowSurrogate = after >= 0xdc00 && after <= 0xdfff;
  return isHighSurrogate || isLowSurrogate;
}

export interface FontFit {
  /** Chosen font size, always inside [STICKY_FONT_MIN_PX, STICKY_FONT_MAX_PX]. */
  fontPx: number;
  /** True when the text does not fit even at the minimum: show the fade. */
  overflow: boolean;
}

/**
 * Pick the largest integer font size, from `STICKY_FONT_MAX_PX` down to
 * `STICKY_FONT_MIN_PX`, at which the element's content still fits in `box`
 * pixels, and leave the element styled with it. Sizes are world units, so the
 * text scales with the board zoom by itself.
 *
 * When even the smallest size overflows, `overflow` is true: the caller then
 * clips the text inside the note and fades its bottom edge, so nothing is ever
 * drawn outside the note.
 *
 * Only the element's `style.fontSize` and `scrollHeight` are used, so the fit
 * can be driven from a test with a stand-in element.
 */
export function fitFontSize(el: HTMLElement, box: number): FontFit {
  const choose = (size: number): boolean => {
    el.style.fontSize = `${size}px`;
    return Number.isFinite(box) ? el.scrollHeight <= box : true;
  };

  let result: FontFit;
  if (choose(STICKY_FONT_MAX_PX)) {
    result = { fontPx: STICKY_FONT_MAX_PX, overflow: false };
  } else if (!choose(STICKY_FONT_MIN_PX)) {
    result = { fontPx: STICKY_FONT_MIN_PX, overflow: true };
  } else {
    // fits(lo), does not fit(hi): binary search the largest size that fits.
    let lo = STICKY_FONT_MIN_PX;
    let hi = STICKY_FONT_MAX_PX;
    while (hi - lo > 1) {
      const mid = Math.floor((lo + hi) / 2);
      if (choose(mid)) lo = mid;
      else hi = mid;
    }
    result = { fontPx: lo, overflow: false };
  }

  el.style.fontSize = `${result.fontPx}px`;
  return result;
}
