import type * as Y from 'yjs';
import {
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_TEXT_MAX_CHARS,
} from '../../shared/config';

/**
 * Sticky note text logic (anchor `sticky.text`).
 *
 * `clampToLimit`, `applyTextDiff` and `counterVisible` are pure and unit tested.
 * `fitFontSize` needs real text layout, so it is verified in the browser (e2e
 * TC-33); component tests only check that a font size is chosen.
 */

const isHighSurrogate = (code: number): boolean => code >= 0xd800 && code <= 0xdbff;
const isLowSurrogate = (code: number): boolean => code >= 0xdc00 && code <= 0xdfff;

/**
 * At most STICKY_TEXT_MAX_CHARS characters of `next`. Characters beyond the
 * limit are dropped; a surrogate pair that would be cut in half is dropped
 * whole, so clamped text is always valid.
 */
export function clampToLimit(next: string, max: number = STICKY_TEXT_MAX_CHARS): string {
  if (!(typeof max === 'number') || !Number.isFinite(max) || max < 0) {
    return '';
  }
  if (next.length <= max) {
    return next;
  }
  if (max === 0) {
    return '';
  }
  const last = next.charCodeAt(max - 1);
  // Cutting between a high and a low surrogate would corrupt the character.
  const length = isHighSurrogate(last) || isLowSurrogate(next.charCodeAt(max)) ? max - 1 : max;
  return next.slice(0, length);
}

export interface TextDiff {
  readonly start: number;
  readonly deleteLength: number;
  readonly insert: string;
}

/**
 * The single change that turns `prev` into `next`: the common prefix and the
 * common suffix are kept, and only the different middle is rewritten. Boundaries
 * are moved so a surrogate pair is never split.
 */
function minimalDiff(prev: string, next: string): TextDiff {
  const minLen = Math.min(prev.length, next.length);

  let prefix = 0;
  while (prefix < minLen && prev.charCodeAt(prefix) === next.charCodeAt(prefix)) {
    prefix += 1;
  }
  // A common prefix must not end between a surrogate pair.
  if (prefix > 0 && prefix < prev.length && isHighSurrogate(prev.charCodeAt(prefix - 1))) {
    prefix -= 1;
  }

  let suffix = 0;
  while (
    suffix < minLen - prefix &&
    prev.charCodeAt(prev.length - 1 - suffix) === next.charCodeAt(next.length - 1 - suffix)
  ) {
    suffix += 1;
  }
  // A common suffix must not start between a surrogate pair.
  if (suffix > 0 && isLowSurrogate(prev.charCodeAt(prev.length - suffix))) {
    suffix -= 1;
  }

  return {
    start: prefix,
    deleteLength: prev.length - prefix - suffix,
    insert: next.slice(prefix, next.length - suffix),
  };
}

/**
 * Write `next` into `ytext` with the minimal change - one delete and/or one
 * insert, inside a single transaction with the caller's origin. A full replace
 * would destroy characters other people typed at the same time (story 3).
 */
export function applyTextDiff(ytext: Y.Text, next: string, origin: unknown): void {
  const prev = ytext.toString();
  if (prev === next) {
    return;
  }
  const { start, deleteLength, insert } = minimalDiff(prev, next);
  const doc = ytext.doc;
  const write = (): void => {
    if (deleteLength > 0) {
      ytext.delete(start, deleteLength);
    }
    if (insert.length > 0) {
      ytext.insert(start, insert);
    }
  };
  if (doc) {
    doc.transact(write, origin);
  } else {
    write();
  }
}

/**
 * Apply the change a person made to the text they were looking at.
 *
 * `previous` is what their editor showed, `next` is what they changed it to, and
 * only the difference between those two is written to the document - never the
 * whole value. That is what keeps story 3 honest: if someone else typed in the
 * same note in the meantime, their characters are still in the document and this
 * write cannot overwrite them. `applyTextDiff` above cannot promise that, because
 * it rewrites the middle between the document and a value the writer remembers.
 *
 * The position is where the person's own edit was in the text they saw. Another
 * person's edit elsewhere cannot be disturbed by it; an edit at the very same
 * spot is resolved by Yjs, which is what "no lost update" means here.
 */
export function applyTextDelta(
  ytext: Y.Text,
  previous: string,
  next: string,
  origin: unknown,
): void {
  if (previous === next) {
    return;
  }
  const { start, deleteLength, insert } = minimalDiff(previous, next);
  if (deleteLength === 0 && insert.length === 0) {
    return;
  }
  const doc = ytext.doc;
  const write = (): void => {
    if (deleteLength > 0) {
      ytext.delete(start, deleteLength);
    }
    if (insert.length > 0) {
      ytext.insert(start, insert);
    }
  };
  if (doc) {
    doc.transact(write, origin);
  } else {
    write();
  }
}

/** The counter appears when this many characters (or fewer) are left. */
export function counterVisible(length: number): boolean {
  const remaining = STICKY_TEXT_MAX_CHARS - length;
  return remaining <= STICKY_COUNTER_THRESHOLD_CHARS;
}

export interface FontFit {
  readonly fontPx: number;
  readonly overflow: boolean;
}

/**
 * The largest integer font size (in board units, so it scales with zoom) at
 * which the element's text still fits inside `box`. When it does not fit even
 * at STICKY_FONT_MIN_PX the text stays that size and `overflow` reports that the
 * caller must clip it and show the bottom fade.
 *
 * The element is measured directly: its font size is set, then `scrollHeight`
 * is read (which forces layout in the browser), so this must only run when the
 * text or the note itself changed - never per pointer or zoom event.
 */
export function fitFontSize(el: HTMLElement, box: number): FontFit {
  const fitsAt = (fontPx: number): boolean => {
    el.style.fontSize = `${fontPx}px`;
    return el.scrollHeight <= box;
  };

  let low = STICKY_FONT_MIN_PX;
  let high = STICKY_FONT_MAX_PX;
  let best = -1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (fitsAt(middle)) {
      best = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  if (best === -1) {
    el.style.fontSize = `${STICKY_FONT_MIN_PX}px`;
    return { fontPx: STICKY_FONT_MIN_PX, overflow: true };
  }
  el.style.fontSize = `${best}px`;
  return { fontPx: best, overflow: false };
}
