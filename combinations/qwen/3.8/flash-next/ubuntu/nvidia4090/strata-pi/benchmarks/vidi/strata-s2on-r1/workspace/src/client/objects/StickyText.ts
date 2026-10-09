/**
 * Sticky note text logic.
 *
 * The pure functions (clamp, minimal diff, counter visibility) are unit tested;
 * `fitFontSize` needs real text layout, so it is covered by the e2e tests.
 */
import * as Y from "yjs";
import {
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_TEXT_MAX_CHARS,
} from "../../shared/config";

/** At most `max` characters; anything beyond the limit is dropped. */
export function clampToLimit(next: string, max: number = STICKY_TEXT_MAX_CHARS): string {
  if (typeof next !== "string") return "";
  if (!Number.isFinite(max) || max < 0) return next;
  if (next.length <= max) return next;
  // Never cut a surrogate pair in half: that would store a broken character.
  const cut = max > 0 && isHighSurrogate(next.charCodeAt(max - 1)) ? max - 1 : max;
  return next.slice(0, cut);
}

/**
 * Writes `next` into the shared Y.Text with the smallest possible change
 * (common prefix + common suffix, one delete and/or one insert in one
 * transaction). A full replace would destroy whatever a teammate typed in the
 * same note (story 3).
 */
export function applyTextDiff(ytext: Y.Text, next: string, origin: unknown): void {
  if (!(ytext instanceof Y.Text) || typeof next !== "string") return;
  const doc = ytext.doc;
  if (!doc) return;

  const current = ytext.toString();
  if (current === next) return;

  const { prefix, suffix } = diffBounds(current, next);
  const deleteLength = current.length - prefix - suffix;
  const insertText = next.slice(prefix, next.length - suffix);
  if (deleteLength <= 0 && insertText.length === 0) return;

  doc.transact(() => {
    if (deleteLength > 0) ytext.delete(prefix, deleteLength);
    if (insertText.length > 0) ytext.insert(prefix, insertText);
  }, origin);
}

/** The counter appears when this many characters (or fewer) are left. */
export function counterVisible(length: number): boolean {
  if (!Number.isFinite(length) || length < 0) return false;
  return STICKY_TEXT_MAX_CHARS - length <= STICKY_COUNTER_THRESHOLD_CHARS;
}

export interface FontFit {
  fontPx: number;
  overflow: boolean;
}

/**
 * Largest integer font size in [STICKY_FONT_MIN_PX, STICKY_FONT_MAX_PX] whose
 * text still fits in `box` (the note's own height, in board units). When even
 * the smallest size overflows, `overflow` is true and the caller clips the text
 * and shows the bottom fade.
 *
 * Sizes are measured in the note's own layout space, which the world layer
 * scales uniformly, so one measurement serves every zoom level.
 */
export function fitFontSize(el: HTMLElement, box: number): FontFit {
  const fits = (size: number): boolean => {
    el.style.fontSize = `${size}px`;
    return el.scrollHeight <= box;
  };

  if (!Number.isFinite(box) || box <= 0) {
    el.style.fontSize = `${STICKY_FONT_MAX_PX}px`;
    return { fontPx: STICKY_FONT_MAX_PX, overflow: false };
  }
  if (fits(STICKY_FONT_MAX_PX)) return { fontPx: STICKY_FONT_MAX_PX, overflow: false };
  if (!fits(STICKY_FONT_MIN_PX)) return { fontPx: STICKY_FONT_MIN_PX, overflow: true };

  let low = STICKY_FONT_MIN_PX;
  let high = STICKY_FONT_MAX_PX - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (fits(mid)) low = mid;
    else high = mid - 1;
  }
  fits(low);
  return { fontPx: low, overflow: false };
}

// ---- internals -------------------------------------------------------------

interface Bounds {
  prefix: number;
  suffix: number;
}

function diffBounds(current: string, next: string): Bounds {
  const maxPrefix = Math.min(current.length, next.length);
  let prefix = 0;
  while (prefix < maxPrefix && current.charCodeAt(prefix) === next.charCodeAt(prefix)) {
    prefix += 1;
  }
  // Back off if the boundary would land inside a surrogate pair.
  while (
    prefix > 0 &&
    (isLowSurrogateAt(current, prefix) || isLowSurrogateAt(next, prefix))
  ) {
    prefix -= 1;
  }

  const maxSuffix = Math.min(current.length - prefix, next.length - prefix);
  let suffix = 0;
  while (
    suffix < maxSuffix &&
    current.charCodeAt(current.length - 1 - suffix) === next.charCodeAt(next.length - 1 - suffix)
  ) {
    suffix += 1;
  }
  while (
    suffix > 0 &&
    (isHighSurrogateAt(current, current.length - suffix - 1) ||
      isHighSurrogateAt(next, next.length - suffix - 1))
  ) {
    suffix -= 1;
  }

  return { prefix, suffix };
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isHighSurrogateAt(text: string, index: number): boolean {
  return index >= 0 && index < text.length && isHighSurrogate(text.charCodeAt(index));
}

function isLowSurrogateAt(text: string, index: number): boolean {
  return (
    index >= 0 && index < text.length && text.charCodeAt(index) >= 0xdc00 && text.charCodeAt(index) <= 0xdfff
  );
}
