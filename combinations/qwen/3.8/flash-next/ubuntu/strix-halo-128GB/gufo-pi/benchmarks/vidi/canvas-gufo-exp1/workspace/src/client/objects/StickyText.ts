/**
 * Pure text logic for sticky notes (story 2): the 1,000-character clamp, the
 * counter threshold, the minimal Y.Text diff, and the font auto-fit.
 *
 * The diff matters beyond this story: a full replace would destroy concurrent
 * typing from other users once live sync (story 3) ships, so only the minimal
 * insert/delete is written.
 */
import * as Y from 'yjs';
import {
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_TEXT_MAX_CHARS,
} from '../../shared/config';

/** Trim `next` to at most `max` characters (default `STICKY_TEXT_MAX_CHARS`). */
export function clampToLimit(next: string, max: number = STICKY_TEXT_MAX_CHARS): string {
  return next.length > max ? next.slice(0, max) : next;
}

/** True when the remaining characters are at or below the counter threshold. */
export function counterVisible(length: number): boolean {
  return STICKY_TEXT_MAX_CHARS - length <= STICKY_COUNTER_THRESHOLD_CHARS;
}

/**
 * Replace the content of `ytext` with `next` using the minimal delete/insert
 * pair: the common prefix and suffix of the old and new strings are left
 * untouched. Surrogate pairs are kept whole because cutting at a code-unit
 * boundary inside a pair is never inside the common prefix/suffix — the pair's
 * halves differ from whatever replaced them, or the whole pair is common.
 *
 * Does nothing (no transaction) when the text is already equal.
 */
export function applyTextDiff(ytext: Y.Text, next: string, origin: unknown): void {
  const current = ytext.toString();
  if (current === next) return;

  // Common prefix.
  const minLen = Math.min(current.length, next.length);
  let prefix = 0;
  while (prefix < minLen && current.charCodeAt(prefix) === next.charCodeAt(prefix)) {
    prefix += 1;
  }

  // Common suffix, never overlapping the prefix.
  let suffix = 0;
  while (
    suffix < minLen - prefix &&
    current.charCodeAt(current.length - 1 - suffix) === next.charCodeAt(next.length - 1 - suffix)
  ) {
    suffix += 1;
  }

  // Do not split a surrogate pair at either cut point. Back the start off and
  // the end forward by one code unit when a cut would fall between a high and
  // its low surrogate. The prefix/suffix characters are equal in both strings,
  // so checking one of them is enough.
  const isLow = (unit: number): boolean => unit >= 0xdc00 && unit <= 0xdfff;
  while (prefix > 0 && prefix < current.length && isLow(current.charCodeAt(prefix))) {
    prefix -= 1;
  }
  while (
    suffix > 0 &&
    suffix < current.length - prefix &&
    isLow(current.charCodeAt(current.length - suffix))
  ) {
    suffix -= 1;
  }

  const deleteLength = current.length - suffix - prefix;
  const insertText = next.slice(prefix, next.length - suffix);

  if (deleteLength <= 0 && insertText.length === 0) return;

  const doc = ytext.doc;
  const run = (): void => {
    if (deleteLength > 0) ytext.delete(prefix, deleteLength);
    if (insertText.length > 0) ytext.insert(prefix, insertText);
  };
  if (doc) {
    doc.transact(run, origin);
  } else {
    run();
  }
}

/**
 * Largest integer font size in [STICKY_FONT_MIN_PX, STICKY_FONT_MAX_PX] at which the
 * element's own text still fits: the element is height-constrained by the note
 * (`height: 100%; overflow: hidden`), so text that no longer fits is exactly the
 * case where `scrollHeight` exceeds `clientHeight`.
 *
 * When even the minimum size overflows, the minimum is returned with
 * `overflow: true` so the caller can show the bottom fade.
 *
 * Runs on text change and on mount only — zoom scales uniformly (the font is in
 * world units), so it does not depend on zoom.
 */
export function fitFontSize(el: HTMLElement): { fontPx: number; overflow: boolean } {
  const fits = (px: number): boolean => {
    el.style.fontSize = `${px}px`;
    return el.scrollHeight <= el.clientHeight;
  };

  if (fits(STICKY_FONT_MAX_PX)) return { fontPx: STICKY_FONT_MAX_PX, overflow: false };
  if (!fits(STICKY_FONT_MIN_PX)) {
    el.style.fontSize = `${STICKY_FONT_MIN_PX}px`;
    return { fontPx: STICKY_FONT_MIN_PX, overflow: true };
  }

  // Binary search the largest fitting integer size.
  let lo = STICKY_FONT_MIN_PX;
  let hi = STICKY_FONT_MAX_PX;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (fits(mid)) lo = mid;
    else hi = mid - 1;
  }
  el.style.fontSize = `${lo}px`;
  return { fontPx: lo, overflow: false };
}
