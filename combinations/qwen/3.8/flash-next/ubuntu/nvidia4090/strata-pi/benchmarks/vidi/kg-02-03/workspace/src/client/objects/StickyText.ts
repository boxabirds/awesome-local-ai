import * as Y from "yjs";
import {
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_TEXT_MAX_CHARS,
} from "../../shared/config";

/**
 * Sticky note text logic (story 2).
 *
 * The text of a note lives in a `Y.Text`, so every edit has to be expressed as
 * the smallest possible change: a rewrite of the whole string would destroy
 * anything another person typed in the same note (story 3).
 */

/** Keeps at most `max` characters, and never cuts a surrogate pair in half. */
export function clampToLimit(next: string, max: number = STICKY_TEXT_MAX_CHARS): string {
  if (typeof next !== "string") return "";
  const limit = Number.isFinite(max) ? Math.max(0, Math.floor(max)) : STICKY_TEXT_MAX_CHARS;
  if (next.length <= limit) return next;

  let cut = limit;
  // Dropping the last character is better than storing half of an emoji.
  if (isHighSurrogate(next.charCodeAt(cut - 1))) cut -= 1;
  return next.slice(0, cut);
}

/** True when the "n/1000" counter should be shown (50 characters or fewer left). */
export function counterVisible(length: number): boolean {
  if (!Number.isFinite(length)) return false;
  return STICKY_TEXT_MAX_CHARS - length <= STICKY_COUNTER_THRESHOLD_CHARS;
}

/**
 * Writes `next` into `ytext` as one delete and/or one insert inside a single
 * transaction: the common prefix and the common suffix are kept untouched, and
 * surrogate pairs are never split by the boundaries.
 */
export function applyTextDiff(ytext: Y.Text, next: string, origin: unknown): void {
  const current = ytext.toString();
  if (current === next) return;

  let prefix = 0;
  const maxPrefix = Math.min(current.length, next.length);
  while (prefix < maxPrefix && current.charCodeAt(prefix) === next.charCodeAt(prefix)) {
    prefix += 1;
  }

  let suffix = 0;
  const maxSuffix = Math.min(current.length - prefix, next.length - prefix);
  while (
    suffix < maxSuffix &&
    current.charCodeAt(current.length - 1 - suffix) === next.charCodeAt(next.length - 1 - suffix)
  ) {
    suffix += 1;
  }

  // Boundary safety: kept text may not end on a high surrogate and the kept
  // tail may not start on a low surrogate, or a code point gets cut in half.
  if (
    prefix > 0 &&
    prefix < current.length &&
    prefix < next.length &&
    isHighSurrogate(current.charCodeAt(prefix - 1))
  ) {
    prefix -= 1;
  }
  if (
    suffix > 0 &&
    current.length - suffix > prefix &&
    isLowSurrogate(current.charCodeAt(current.length - suffix))
  ) {
    suffix -= 1;
  }

  const removed = current.length - prefix - suffix;
  const added = next.slice(prefix, next.length - suffix);
  if (removed <= 0 && added.length === 0) return;

  const apply = () => {
    if (removed > 0) ytext.delete(prefix, removed);
    if (added.length > 0) ytext.insert(prefix, added);
  };

  const doc = ytext.doc;
  if (doc) doc.transact(apply, origin);
  else apply();
}

/**
 * Largest whole-pixel font size in [STICKY_FONT_MIN_PX, STICKY_FONT_MAX_PX] at
 * which the element's text still fits `box` (its own content box). When even
 * the smallest size overflows, `overflow` is true and the caller clips the
 * text and fades the bottom edge.
 *
 * The measurement writes `font-size` while searching and restores it
 * afterwards; the caller applies the returned size.
 */
export function fitFontSize(el: HTMLElement, box: number): { fontPx: number; overflow: boolean } {
  const declared = el.style.fontSize;
  let low = STICKY_FONT_MIN_PX;
  let high = STICKY_FONT_MAX_PX;
  let fitted = 0;

  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    el.style.fontSize = `${middle}px`;
    if (el.scrollHeight <= box || box <= 0) {
      fitted = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  el.style.fontSize = declared;
  if (fitted > 0) return { fontPx: fitted, overflow: false };
  return { fontPx: STICKY_FONT_MIN_PX, overflow: true };
}

// ---- internals ------------------------------------------------------------

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}
