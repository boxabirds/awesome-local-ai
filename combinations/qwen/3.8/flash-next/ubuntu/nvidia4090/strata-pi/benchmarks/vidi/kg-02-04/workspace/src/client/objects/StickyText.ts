import * as Y from "yjs";
import {
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_TEXT_MAX_CHARS,
} from "../../shared/config";

/**
 * Pure text logic behind sticky note editing (sticky.text):
 *
 * - `clampToLimit`  — nothing beyond the character limit is ever kept,
 * - `applyTextDiff` — the *minimal* change into the note's `Y.Text`, so typing
 *   by other people (story 3) is never destroyed,
 * - `counterVisible` — when the "n/1000" counter appears,
 * - `fitFontSize`   — the largest readable font size that fits the note.
 */

export interface FontFit {
  /** Chosen font size in world units (scales with board zoom). */
  fontPx: number;
  /** True when the text does not fit even at the smallest size. */
  overflow: boolean;
}

/** At most `max` characters; characters past the limit are dropped. */
export function clampToLimit(next: string, max: number = STICKY_TEXT_MAX_CHARS): string {
  if (!Number.isFinite(max) || max <= 0) return "";
  if (next.length <= max) return next;

  let cut = max;
  // Never split a surrogate pair: a lone surrogate is not a character.
  if (isHighSurrogate(next.charCodeAt(cut - 1)) && isLowSurrogate(next.charCodeAt(cut))) {
    cut -= 1;
  }
  return next.slice(0, cut);
}

/**
 * Writes `next` into `ytext` with the smallest change Yjs can record: a common
 * prefix and a common suffix are left alone, so only the edited span is
 * inserted or deleted. A full replace would let a local keystroke destroy text
 * typed by someone else (story 3), which is why this is required, not an
 * optimisation.
 */
export function applyTextDiff(ytext: Y.Text, next: string, origin: unknown): void {
  const current = ytext.toString();
  if (current === next) return;
  // A note that has been deleted (or never attached) is not written to.
  if (!ytext.doc) return;

  let start = 0;
  const shortest = Math.min(current.length, next.length);
  while (start < shortest && current.charCodeAt(start) === next.charCodeAt(start)) {
    start += 1;
  }

  let endCurrent = current.length;
  let endNext = next.length;
  while (
    endCurrent > start &&
    endNext > start &&
    current.charCodeAt(endCurrent - 1) === next.charCodeAt(endNext - 1)
  ) {
    endCurrent -= 1;
    endNext -= 1;
  }

  // Keep whole characters at both ends of the edited span.
  if (
    start > 0 &&
    start < current.length &&
    isHighSurrogate(current.charCodeAt(start - 1)) &&
    isLowSurrogate(current.charCodeAt(start))
  ) {
    start -= 1;
  }
  if (
    endCurrent > start &&
    endCurrent < current.length &&
    isHighSurrogate(current.charCodeAt(endCurrent - 1)) &&
    isLowSurrogate(current.charCodeAt(endCurrent))
  ) {
    endCurrent += 1;
    endNext += 1;
  }

  const deleteLength = endCurrent - start;
  const insertText = next.slice(start, endNext);
  if (deleteLength <= 0 && insertText.length === 0) return;

  docOf(ytext).transact(() => {
    if (deleteLength > 0) ytext.delete(start, deleteLength);
    if (insertText.length > 0) ytext.insert(start, insertText);
  }, origin);
}

/** The counter appears once this many characters (or fewer) are left. */
export function counterVisible(length: number): boolean {
  if (!Number.isFinite(length)) return false;
  return STICKY_TEXT_MAX_CHARS - length <= STICKY_COUNTER_THRESHOLD_CHARS;
}

/**
 * Largest integer font size in [STICKY_FONT_MIN_PX, STICKY_FONT_MAX_PX] whose
 * text still fits the note box. When even the smallest size overflows, the
 * text stays at that size, is clipped by the note and `overflow` reports the
 * fade the caller must show.
 *
 * Sizes are world units, so the measured fit at 100% zoom holds at every zoom:
 * the world layer scales text and box together.
 */
export function fitFontSize(el: HTMLElement, box: number): FontFit {
  const limit = Number.isFinite(box) && box > 0 ? box : 0;
  const fits = () => el.scrollHeight <= limit;

  // Fast path: the common case (short text) needs one measurement.
  el.style.fontSize = `${STICKY_FONT_MAX_PX}px`;
  if (fits()) return { fontPx: STICKY_FONT_MAX_PX, overflow: false };

  el.style.fontSize = `${STICKY_FONT_MIN_PX}px`;
  if (!fits()) return { fontPx: STICKY_FONT_MIN_PX, overflow: true };

  let low = STICKY_FONT_MIN_PX;
  let high = STICKY_FONT_MAX_PX - 1;
  let best = STICKY_FONT_MIN_PX;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    el.style.fontSize = `${middle}px`;
    if (fits()) {
      best = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  el.style.fontSize = `${best}px`;
  return { fontPx: best, overflow: false };
}

// ---- internals ------------------------------------------------------------

function docOf(ytext: Y.Text): Y.Doc {
  const doc = ytext.doc as Y.Doc | null;
  if (!doc) throw new Error("applyTextDiff: the Y.Text is not attached to a document");
  return doc;
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}
