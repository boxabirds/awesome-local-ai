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
import {
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_TEXT_MAX_CHARS,
} from '../../shared/config';
import {
  applyTextDiff as applyTextDiffOf,
  clampToLimit as clampToLength,
  counterVisible as counterVisibleOf,
} from '../../shared/text-edit';

/**
 * The note's share of the two shared text rules.
 *
 * Both come from `shared/text-edit.ts` now that a sticky note is not the only thing on the board with
 * text. `applyTextDiff` is the same function for every type, so it is handed on as it is. `clampToLimit`
 * is handed on with the note's limit filled in, which is what lets every story 2 call site keep saying
 * `clampToLimit(next)` and still mean a thousand characters: the limit is a property of the note, and the
 * rule is a property of the board.
 */
export const applyTextDiff: (ytext: Parameters<typeof applyTextDiffOf>[0], next: string, origin: unknown) => void =
  applyTextDiffOf;

export function clampToLimit(next: string, max: number = STICKY_TEXT_MAX_CHARS): string {
  return clampToLength(next, max);
}

/**
 * The character counter appears only when the note is close to the limit —
 * `STICKY_COUNTER_THRESHOLD_CHARS` characters or fewer remaining — so a note
 * being written normally never shows it.
 *
 * The rule itself is the board's (`shared/text-edit.ts`), since a piece of free text counts down to a
 * different number the same way; what is the note's is the limit it counts towards and the distance at
 * which it starts saying so, and those two are filled in here so that every story 2 call site still calls
 * this with a length and nothing else.
 */
export function counterVisible(
  length: number,
  max: number = STICKY_TEXT_MAX_CHARS,
  threshold: number = STICKY_COUNTER_THRESHOLD_CHARS,
): boolean {
  return counterVisibleOf(length, max, threshold);
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
 * The font sizes a fitted box may choose between.
 */
export interface FontBounds {
  minPx: number;
  maxPx: number;
}

/** The bounds a sticky note's text is fitted inside. */
export const STICKY_FONT_BOUNDS: FontBounds = { minPx: STICKY_FONT_MIN_PX, maxPx: STICKY_FONT_MAX_PX };

/**
 * The largest integer font size in `[bounds.minPx, bounds.maxPx]` at which the element's content fits in
 * `box` pixels of height, found by binary search. Font sizes are board units, so this is measured and
 * applied at 100% zoom and scales with the board uniformly — a zoom never needs a refit.
 *
 * The bounds are a parameter because a sticky note's text and a later object's text are not fitted
 * between the same two sizes; the note's bounds are the default, so nothing that was already calling this
 * changed when the parameter appeared.
 *
 * If the text does not fit even at the minimum size, that size is returned with
 * `overflow: true`: the caller clips the note and fades its bottom edge, so nothing is drawn outside it.
 *
 * The size is left applied to the element, since that is the size it displays at. `box` is the height
 * available to the text (note size minus padding).
 */
export function fitFontSize(el: HTMLElement, box: number, bounds: FontBounds = STICKY_FONT_BOUNDS): Fit {
  const fits = (fontPx: number): boolean => {
    el.style.fontSize = `${fontPx}px`;
    return el.scrollHeight <= box;
  };

  if (!Number.isFinite(box) || box <= 0) return { fontPx: bounds.minPx, overflow: true };
  if (fits(bounds.maxPx)) return { fontPx: bounds.maxPx, overflow: false };
  // Nothing above the floor fits either; the note keeps the smallest size and
  // reports the overflow so the fade is shown.
  if (!fits(bounds.minPx)) return { fontPx: bounds.minPx, overflow: true };

  // `lowest` fits, `highest` does not; converge on the largest that fits.
  let lowest = bounds.minPx;
  let highest = bounds.maxPx;
  while (highest - lowest > 1) {
    const middle = Math.floor((lowest + highest) / 2);
    if (fits(middle)) lowest = middle;
    else highest = middle;
  }
  return { fontPx: lowest, overflow: false };
}
