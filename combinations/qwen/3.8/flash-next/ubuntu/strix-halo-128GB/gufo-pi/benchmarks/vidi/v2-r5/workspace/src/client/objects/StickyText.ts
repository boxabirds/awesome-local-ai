import * as Y from 'yjs';
import {
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_TEXT_MAX_CHARS,
} from '../../shared/config';

/**
 * Pure text helpers behind sticky note editing: the character limit, the minimal diff into a
 * shared `Y.Text`, the counter's visibility rule and the auto-fit font size. They live apart
 * from the component so every rule is unit-testable and shared by display and edit mode.
 */

const HIGH_SURROGATE_START = 0xd800;
const HIGH_SURROGATE_END = 0xdbff;

/** Keep at most `max` characters; anything beyond the limit is dropped (never half a pair). */
export function clampToLimit(next: string, max: number = STICKY_TEXT_MAX_CHARS): string {
  if (!(max >= 0)) return '';
  if (next.length <= max) return next;
  let cut = max;
  const last = next.charCodeAt(cut - 1);
  // A cut between a high and a low surrogate would create a lone surrogate: cut earlier.
  if (last >= HIGH_SURROGATE_START && last <= HIGH_SURROGATE_END) cut -= 1;
  return next.slice(0, cut);
}

/**
 * Write `next` into `ytext` with the minimal change: the common prefix and the common suffix
 * are left alone, so only the edited span is replaced. This is what keeps another user's
 * concurrent typing (story 3) intact — a full rewrite would delete their characters.
 *
 * The comparison walks whole code points, so emoji are never split into lone surrogates.
 * Text over the limit is clamped first, so a caller cannot write past it by accident.
 */
export function applyTextDiff(ytext: Y.Text, nextRaw: string, origin: unknown): void {
  const next = clampToLimit(nextRaw);
  const current = ytext.toString();
  if (current === next) return;

  // Code-point arrays: an index into them can never land inside a surrogate pair.
  const before = Array.from(current);
  const after = Array.from(next);

  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) {
    start += 1;
  }

  let endBefore = before.length;
  let endAfter = after.length;
  while (
    endBefore > start &&
    endAfter > start &&
    before[endBefore - 1] === after[endAfter - 1]
  ) {
    endBefore -= 1;
    endAfter -= 1;
  }

  const unitLength = (codePoints: string[]): number =>
    codePoints.reduce((total, point) => total + point.length, 0);

  const utf16Start = unitLength(before.slice(0, start));
  const deleteCount = unitLength(before.slice(start, endBefore));
  const insertText = after.slice(start, endAfter).join('');

  ytext.doc?.transact(() => {
    if (deleteCount > 0) ytext.delete(utf16Start, deleteCount);
    if (insertText.length > 0) ytext.insert(utf16Start, insertText);
  }, origin);
}

/** The character counter appears once this many characters (or fewer) remain. */
export function counterVisible(length: number): boolean {
  if (!Number.isFinite(length) || length <= 0) return false;
  return STICKY_TEXT_MAX_CHARS - length <= STICKY_COUNTER_THRESHOLD_CHARS;
}

export interface FontFit {
  fontPx: number;
  overflow: boolean;
}

/**
 * Largest integer font size in [STICKY_FONT_MIN_PX, STICKY_FONT_MAX_PX] at which the
 * element's content still fits inside a box of `box` pixels, measured with `scrollHeight`.
 * When it does not fit even at the minimum, the font stays at the minimum and `overflow` is
 * true, so the caller clips the note and fades its bottom edge.
 *
 * The element is measured at its current width; the returned size is applied as an inline
 * style, which is what the caller renders. Sizes are in board units, so the text scales with
 * zoom for free and this only has to run when the text changes (not on zoom).
 */
export function fitFontSize(el: HTMLElement, box: number): FontFit {
  const fitsAt = (px: number): boolean => {
    el.style.fontSize = `${px}px`;
    return el.scrollHeight <= box;
  };

  if (fitsAt(STICKY_FONT_MAX_PX)) return { fontPx: STICKY_FONT_MAX_PX, overflow: false };
  if (!fitsAt(STICKY_FONT_MIN_PX)) return { fontPx: STICKY_FONT_MIN_PX, overflow: true };

  // Invariant: `low` fits, `high` does not.
  let low = STICKY_FONT_MIN_PX;
  let high = STICKY_FONT_MAX_PX;
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (fitsAt(middle)) low = middle;
    else high = middle;
  }
  fitsAt(low);
  return { fontPx: low, overflow: false };
}
