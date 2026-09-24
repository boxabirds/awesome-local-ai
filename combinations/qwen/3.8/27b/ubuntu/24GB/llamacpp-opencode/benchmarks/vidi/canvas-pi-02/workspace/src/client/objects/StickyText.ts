import * as Y from 'yjs';
import {
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_TEXT_MAX_CHARS,
} from '../../shared/config';

/**
 * Pure sticky-note text logic: length clamping, the minimal Y.Text diff and
 * the font-fit measurement. All of it is framework-free so it can be unit
 * tested against a real Y.Text.
 *
 * Y.Text indices in Yjs 13 are UTF-16 code units, so the diff works in
 * code units; a change that touches a surrogate pair always deletes/inserts
 * whole pairs (the diff never starts or ends mid-pair in practice because
 * the textarea edits whole code units too).
 */

/** Keep at most `max` characters (default STICKY_TEXT_MAX_CHARS); the tail is dropped. */
export function clampToLimit(next: string, max: number = STICKY_TEXT_MAX_CHARS): string {
  return next.length > max ? next.slice(0, max) : next;
}

/** The counter shows once the note is within STICKY_COUNTER_THRESHOLD_CHARS of the limit. */
export function counterVisible(length: number): boolean {
  return STICKY_TEXT_MAX_CHARS - length <= STICKY_COUNTER_THRESHOLD_CHARS;
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

/**
 * Apply the minimal change that turns `ytext` into `next`: common prefix and
 * suffix are kept, leaving at most one delete and one insert in a single
 * transaction. A full replace would destroy concurrent typing once story 3
 * ships, so the minimal diff is required.
 *
 * The diff boundaries are nudged back over a leading high surrogate when the
 * common prefix/suffix would end mid surrogate pair: Yjs corrupts the text
 * if a delete or insert lands between the two halves of a pair, so the
 * changed span always covers whole pairs.
 */
export function applyTextDiff(ytext: Y.Text, next: string, origin: unknown): void {
  const current = ytext.toString();
  if (current === next) return;

  const minLen = Math.min(current.length, next.length);
  let prefix = 0;
  while (prefix < minLen && current.charCodeAt(prefix) === next.charCodeAt(prefix)) prefix += 1;
  // Never end the prefix between the two halves of a pair in `current`.
  if (prefix > 0 && isHighSurrogate(current.charCodeAt(prefix - 1))) prefix -= 1;

  let suffix = 0;
  while (
    suffix < minLen - prefix &&
    current.charCodeAt(current.length - 1 - suffix) === next.charCodeAt(next.length - 1 - suffix)
  ) {
    suffix += 1;
  }
  // Never start the suffix between the two halves of a pair in `current`.
  const endBefore = current.length - suffix;
  if (endBefore > 0 && isHighSurrogate(current.charCodeAt(endBefore - 1))) suffix += 1;

  const deleteLength = current.length - prefix - suffix;
  const runInTransaction = (fn: () => void): void => {
    // A doc-bound Y.Text gets one transaction (one update, one undo step).
    // An unbound Y.Text has no doc; each op is then its own transaction.
    if (ytext.doc) {
      ytext.doc.transact(fn, origin);
    } else {
      fn();
    }
  };

  if (deleteLength < 0) {
    // Degenerate (invalid) input: fall back to a full replace.
    runInTransaction(() => {
      ytext.delete(0, current.length);
      ytext.insert(0, next);
    });
    return;
  }
  const insertText = next.slice(prefix, next.length - suffix);

  runInTransaction(() => {
    if (deleteLength > 0) ytext.delete(prefix, deleteLength);
    if (insertText.length > 0) ytext.insert(prefix, insertText);
  });
}

export interface FontFit {
  /** Chosen font size in world px, within [STICKY_FONT_MIN_PX, STICKY_FONT_MAX_PX]. */
  fontPx: number;
  /** True when the text does not fit even at the smallest size (show the fade). */
  overflow: boolean;
}

/**
 * Find the largest integer font size (world px) in [STICKY_FONT_MIN_PX,
 * STICKY_FONT_MAX_PX] at which `el`'s text fits inside `box` px of height,
 * by binary search over `scrollHeight <= box`. `el` must contain the note's
 * text and have the note's content width and wrapping; it is left at the
 * chosen size. Runs on text change and mount only (zoom scales world units
 * uniformly, so the fit never depends on zoom).
 */
export function fitFontSize(el: HTMLElement, box: number): FontFit {
  let low = STICKY_FONT_MIN_PX;
  let high = STICKY_FONT_MAX_PX;
  let best = STICKY_FONT_MIN_PX;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    el.style.fontSize = `${mid}px`;
    if (el.scrollHeight <= box) {
      best = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  el.style.fontSize = `${best}px`;
  const overflow = el.scrollHeight > box;
  return { fontPx: best, overflow };
}
