/**
 * Sticky note text: length limit, minimal Y.Text diffing and font auto-fit
 * (story 2, anchor sticky.text).
 *
 * The pure functions here (`clampToLimit`, `applyTextDiff`, `counterVisible`,
 * `fitFontSize`) are used by `StickyTextEditor` for editing and by
 * `StickyNote` for the display text, so both modes behave identically.
 */
import * as Y from "yjs";
import { LOCAL_ORIGIN } from "../../shared/board-model";
import {
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_TEXT_MAX_CHARS,
} from "../../shared/config";

/** Padding (world units) around note text, in display and editor modes. */
export const STICKY_TEXT_PADDING_WORLD = 12;

/** Keep at most `max` characters (product default: STICKY_TEXT_MAX_CHARS). */
export function clampToLimit(next: string, max: number = STICKY_TEXT_MAX_CHARS): string {
  return next.length <= max ? next : next.slice(0, max);
}

/**
 * True when the counter should be shown: at most
 * STICKY_COUNTER_THRESHOLD_CHARS characters remain until the limit.
 */
export function counterVisible(length: number): boolean {
  return STICKY_TEXT_MAX_CHARS - length <= STICKY_COUNTER_THRESHOLD_CHARS;
}

/**
 * Apply the minimal change that turns `ytext` into `next` (common prefix +
 * common suffix), so concurrent typing by others (story 3) is never
 * destroyed: a one-character edit produces one insert or one delete, never
 * a full replace. The change is written in a single transaction with
 * `origin` (default LOCAL_ORIGIN). No transaction at all when `next` equals
 * the current text.
 *
 * Works on UTF-16 code units; the diff boundaries can never split a
 * surrogate pair in the *result* because both strings are compared unit by
 * unit (a pair is either fully in the prefix/suffix or fully in the changed
 * range).
 */
export function applyTextDiff(
  ytext: Y.Text,
  next: string,
  origin: unknown = LOCAL_ORIGIN,
): void {
  const current = ytext.toString();
  if (current === next) return;

  let prefix = 0;
  const minLen = Math.min(current.length, next.length);
  while (prefix < minLen && current.charCodeAt(prefix) === next.charCodeAt(prefix)) {
    prefix++;
  }
  let suffix = 0;
  const maxSuffix = minLen - prefix;
  while (
    suffix < maxSuffix &&
    current.charCodeAt(current.length - 1 - suffix) ===
      next.charCodeAt(next.length - 1 - suffix)
  ) {
    suffix++;
  }

  const insertAt = prefix;
  const deleteLen = current.length - prefix - suffix;
  const insertText = next.slice(prefix, next.length - suffix);

  const ydoc = ytext.doc;
  if (ydoc === null) return; // detached; nothing to write
  ydoc.transact(() => {
    if (deleteLen > 0) ytext.delete(insertAt, deleteLen);
    if (insertText.length > 0) ytext.insert(insertAt, insertText);
  }, origin);
}

export interface FontFit {
  /**
   * Largest integer font size (world units; px at 100% zoom) at which the
   * text fits, clamped to [STICKY_FONT_MIN_PX, STICKY_FONT_MAX_PX].
   */
  fontPx: number;
  /** True when the text does not fit even at STICKY_FONT_MIN_PX. */
  overflow: boolean;
}

/**
 * Binary-search the largest integer font size in
 * [STICKY_FONT_MIN_PX, STICKY_FONT_MAX_PX] at which `el`'s content height
 * (`scrollHeight`, which includes the note's padding) is at most `box`.
 * Leaves `el` at the chosen size. The font is in world units, so it scales
 * uniformly with board zoom — this only needs to re-run when the text
 * changes, not when the zoom does.
 *
 * When even the minimum size overflows, `overflow` is true: the caller
 * clips the text (overflow hidden) and shows a fade at the note's bottom
 * edge, so nothing is drawn outside the note.
 */
export function fitFontSize(el: HTMLElement, box: number): FontFit {
  let lo = STICKY_FONT_MIN_PX;
  let hi = STICKY_FONT_MAX_PX;
  let best = STICKY_FONT_MIN_PX;
  let fits = false;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    el.style.fontSize = `${mid}px`;
    if (el.scrollHeight <= box) {
      best = mid;
      fits = true;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  el.style.fontSize = `${best}px`;
  return { fontPx: best, overflow: !fits };
}
