/**
 * The text logic behind a sticky note: the length limit, the minimal diff into
 * the note's `Y.Text`, when the character counter is shown, and the auto-fit
 * font size.
 *
 * Nothing here is React except `StickyTextEditor.tsx`, which drives these
 * functions from a textarea. Keeping the rules separate means they are
 * unit-testable without a board, and that the same rules can later be reused
 * server-side by story 4 when it validates a document.
 */
import type * as Y from 'yjs';

import { STICKY_COUNTER_THRESHOLD_CHARS, STICKY_FONT_MAX_PX, STICKY_FONT_MIN_PX, STICKY_TEXT_MAX_CHARS } from '../../shared/config';

/**
 * Drop everything past the note's character limit. Typing or pasting that would
 * exceed the limit adds nothing beyond the 1,000th character; below the limit
 * the text is returned untouched (identity included, so callers can compare).
 */
export function clampToLimit(next: string, max: number = STICKY_TEXT_MAX_CHARS): string {
  if (!Number.isFinite(max) || max < 0) return '';
  return next.length > max ? next.slice(0, max) : next;
}

/**
 * The character counter appears only when the note is close to the limit —
 * `STICKY_COUNTER_THRESHOLD_CHARS` characters or fewer remaining — so a note
 * being written normally never shows it.
 */
export function counterVisible(length: number): boolean {
  if (!Number.isFinite(length)) return false;
  return STICKY_TEXT_MAX_CHARS - length <= STICKY_COUNTER_THRESHOLD_CHARS;
}

/**
 * Write `next` into a `Y.Text` with the smallest change that gets there: a
 * common prefix and a common suffix are found and only the difference between
 * them is written, as one delete and/or one insert in one transaction.
 *
 * The minimal diff is not an optimisation: replacing the whole text would
 * discard what other people typed between the last keystroke and this one as
 * soon as the board is shared (story 3). Text with no document attached cannot
 * be written, so it is left alone.
 */
export function applyTextDiff(ytext: Y.Text, next: string, origin: unknown): void {
  const doc = ytext.doc;
  if (!doc) return;

  const current = ytext.toString();
  if (current === next) return;

  const shorter = Math.min(current.length, next.length);
  let start = 0;
  while (start < shorter && current.charCodeAt(start) === next.charCodeAt(start)) start += 1;

  let currentEnd = current.length;
  let nextEnd = next.length;
  while (
    currentEnd > start &&
    nextEnd > start &&
    current.charCodeAt(currentEnd - 1) === next.charCodeAt(nextEnd - 1)
  ) {
    currentEnd -= 1;
    nextEnd -= 1;
  }

  const deleteLength = currentEnd - start;
  const insertText = next.slice(start, Math.max(start, nextEnd));
  if (deleteLength === 0 && insertText === '') return;

  doc.transact(() => {
    if (deleteLength > 0) ytext.delete(start, deleteLength);
    if (insertText !== '') ytext.insert(start, insertText);
  }, origin);
}

/** A text area's cursor: where it is, and what it holds selected. */
export interface Caret {
  start: number;
  end: number;
}

/**
 * Where a cursor ends up when the text it sits in changes underneath it.
 *
 * The change is already known — it is the difference between `before`, the text as the
 * box showing it still has it, and `after`, the text it holds now — and the two are
 * compared exactly the way `applyTextDiff` compares, so the one change between them is
 * the one change the person typing feels. What must not happen is that they lose their
 * place: text put in front of the cursor carries it along with it, text put behind it
 * leaves it where it was, and a cursor that was sitting inside text that has just been
 * replaced stands at the beginning of where that text was.
 */
export function moveCaretThrough(before: string, after: string, caret: Caret): Caret {
  const shorter = Math.min(before.length, after.length);
  let start = 0;
  while (start < shorter && before.charCodeAt(start) === after.charCodeAt(start)) start += 1;

  let beforeEnd = before.length;
  let afterEnd = after.length;
  while (
    beforeEnd > start &&
    afterEnd > start &&
    before.charCodeAt(beforeEnd - 1) === after.charCodeAt(afterEnd - 1)
  ) {
    beforeEnd -= 1;
    afterEnd -= 1;
  }

  const shift = after.length - before.length;
  const move = (index: number): number => {
    if (index <= start) return index; // in front of the change: nothing moved under it
    if (index >= beforeEnd) return Math.max(start, index + shift); // behind it: go with the text
    return start; // inside what was replaced: stand where that text was
  };
  return { start: move(caret.start), end: move(caret.end) };
}

/**
 * The text a finished input-method composition has added to a box, or `null` when it
 * replaced text instead of adding any.
 *
 * While a word is being composed the box is left to the input method — rewriting it mid
 * -composition throws the word away — so the box holds the text the document had when
 * the composition began, plus the word, at the place the cursor was standing. That is
 * enough to pick the new word back out, so it can be written into the document as an
 * insertion at that place. An insertion cannot overwrite what somebody else put in the
 * same note meanwhile, which a write of the box's whole text would do: the box has been
 * showing only this person's words.
 *
 * `baseLength` is the length of the document's text when the composition started, and
 * `caret` the cursor's position in the box then.
 */
export function compositionInsertion(value: string, baseLength: number, caret: number): string | null {
  const added = value.length - baseLength;
  if (added < 0) return null; // the box is shorter than the note was: text was taken away
  const at = Math.min(caret, value.length - added);
  return value.slice(at, at + added);
}

/** A fitted font size and whether the text still does not fit at it. */
export interface Fit {
  fontPx: number;
  overflow: boolean;
}

/**
 * The largest integer font size in `[STICKY_FONT_MIN_PX, STICKY_FONT_MAX_PX]`
 * at which the element's content fits in `box` pixels of height, found by binary
 * search. Font sizes are board units, so this is measured and applied at 100%
 * zoom and scales with the board uniformly — a zoom never needs a refit.
 *
 * If the text does not fit even at the minimum size, that size is returned with
 * `overflow: true`: the caller clips the note and fades its bottom edge, so
 * nothing is drawn outside it.
 *
 * The size is left applied to the element, since that is the size it displays
 * at. `box` is the height available to the text (note size minus padding).
 */
export function fitFontSize(el: HTMLElement, box: number): Fit {
  const fits = (fontPx: number): boolean => {
    el.style.fontSize = `${fontPx}px`;
    return el.scrollHeight <= box;
  };

  if (!Number.isFinite(box) || box <= 0) return { fontPx: STICKY_FONT_MIN_PX, overflow: true };
  if (fits(STICKY_FONT_MAX_PX)) return { fontPx: STICKY_FONT_MAX_PX, overflow: false };
  // Nothing above the floor fits either; the note keeps the smallest size and
  // reports the overflow so the fade is shown.
  if (!fits(STICKY_FONT_MIN_PX)) return { fontPx: STICKY_FONT_MIN_PX, overflow: true };

  // `lowest` fits, `highest` does not; converge on the largest that fits.
  let lowest = STICKY_FONT_MIN_PX;
  let highest = STICKY_FONT_MAX_PX;
  while (highest - lowest > 1) {
    const middle = Math.floor((lowest + highest) / 2);
    if (fits(middle)) lowest = middle;
    else highest = middle;
  }
  return { fontPx: lowest, overflow: false };
}
