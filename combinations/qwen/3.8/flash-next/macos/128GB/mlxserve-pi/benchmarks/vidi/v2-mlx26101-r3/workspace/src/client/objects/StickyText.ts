import * as Y from 'yjs';
import {
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_TEXT_MAX_CHARS,
} from '../../shared/config';

/**
 * Note text helpers: the pure half of sticky note editing.
 *
 * The textarea the user types in is never the source of truth - the note's `Y.Text` is.
 * Every input event is turned into the *minimal* Yjs operation (common prefix and suffix
 * kept), so when two people type in the same note (story 3) their keystrokes merge
 * instead of overwriting each other. A full replace would turn two concurrent keystrokes
 * into two copies of the whole note.
 */

/** Keep at most `max` characters (the product limit unless a test passes one).
 *
 * A cut that would land in the middle of an emoji drops the dangling high surrogate
 * instead of storing half a character.
 */
export function clampToLimit(next: string, max: number = STICKY_TEXT_MAX_CHARS): string {
  if (!(max > 0)) {
    return '';
  }
  if (next.length <= max) {
    return next;
  }
  const cut = next.slice(0, max);
  const last = cut.charCodeAt(cut.length - 1);
  const danglingSurrogate = last >= 0xd800 && last <= 0xdbff;
  return danglingSurrogate ? cut.slice(0, -1) : cut;
}

function isHighSurrogateAt(value: string, index: number): boolean {
  const code = value.charCodeAt(index);
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogateAt(value: string, index: number): boolean {
  const code = value.charCodeAt(index);
  return code >= 0xdc00 && code <= 0xdfff;
}

interface DiffRange {
  start: number;
  delete: number;
  insert: string;
}

/**
 * Common prefix and common suffix of two strings, as one delete plus one insert. Both
 * boundaries are moved off surrogate pairs, so an emoji is never deleted or inserted in
 * halves (the delta stays mergeable for the peer that receives it).
 */
function diffRange(current: string, next: string): DiffRange {
  const shared = Math.min(current.length, next.length);
  let prefix = 0;
  while (prefix < shared && current.charCodeAt(prefix) === next.charCodeAt(prefix)) {
    prefix += 1;
  }
  if (prefix > 0 && isHighSurrogateAt(current, prefix - 1)) {
    prefix -= 1;
  }

  let suffix = 0;
  const maxSuffix = shared - prefix;
  while (
    suffix < maxSuffix &&
    current.charCodeAt(current.length - suffix - 1) === next.charCodeAt(next.length - suffix - 1)
  ) {
    suffix += 1;
  }
  if (suffix > 0 && isLowSurrogateAt(current, current.length - suffix)) {
    suffix -= 1;
  }

  return {
    start: prefix,
    delete: current.length - prefix - suffix,
    insert: next.slice(prefix, next.length - suffix),
  };
}

/**
 * Write `next` into `ytext` with the smallest insert/delete pair, in a single
 * transaction tagged with `origin` (story 8 groups undo by it, story 3 skips echoes).
 * Writing the text it already has emits nothing at all.
 */
export function applyTextDiff(ytext: Y.Text, next: string, origin: unknown): void {
  const current = ytext.toString();
  if (current === next) {
    return;
  }
  const { start, delete: remove, insert } = diffRange(current, next);
  const write = (): void => {
    if (remove > 0) {
      ytext.delete(start, remove);
    }
    if (insert.length > 0) {
      ytext.insert(start, insert);
    }
  };
  const doc = ytext.doc;
  if (doc === null) {
    write();
    return;
  }
  doc.transact(write, origin);
}

/**
 * True when the characters remaining to the limit are few enough to warn about, i.e.
 * `STICKY_COUNTER_THRESHOLD_CHARS` or fewer. The counter is hidden while there is room.
 */
export function counterVisible(length: number): boolean {
  if (!Number.isFinite(length) || length < 0) {
    return false;
  }
  return STICKY_TEXT_MAX_CHARS - length <= STICKY_COUNTER_THRESHOLD_CHARS;
}

export interface FontFit {
  /** Largest size in `[STICKY_FONT_MIN_PX, STICKY_FONT_MAX_PX]` at which the text fits. */
  fontPx: number;
  /** True when the text does not fit even at the smallest size, so it is clipped. */
  overflow: boolean;
}

/**
 * Auto-fit: measure `el` and return the largest whole-pixel font size at which its text
 * still fits the given box height, so a one-word note is big and a full note is small.
 *
 * `el` is measured by temporarily changing its own `font-size` (restored before
 * returning); the caller then applies the returned size for real. Layout is read from
 * `scrollHeight`, so this needs a real layout engine - which is why the fit is verified
 * end to end in the browser rather than in jsdom.
 */
export function fitFontSize(el: HTMLElement, box: number): FontFit {
  const previous = el.style.fontSize;
  const fitsAt = (size: number): boolean => {
    el.style.fontSize = `${size}px`;
    return el.scrollHeight <= box;
  };
  try {
    if (fitsAt(STICKY_FONT_MAX_PX)) {
      return { fontPx: STICKY_FONT_MAX_PX, overflow: false };
    }
    if (!fitsAt(STICKY_FONT_MIN_PX)) {
      // Even the smallest readable size overflows: the caller clips and fades the bottom.
      return { fontPx: STICKY_FONT_MIN_PX, overflow: true };
    }
    let low = STICKY_FONT_MIN_PX;
    let high = STICKY_FONT_MAX_PX;
    while (high - low > 1) {
      const middle = Math.floor((low + high) / 2);
      if (fitsAt(middle)) {
        low = middle;
      } else {
        high = middle;
      }
    }
    return { fontPx: low, overflow: false };
  } finally {
    el.style.fontSize = previous;
  }
}
