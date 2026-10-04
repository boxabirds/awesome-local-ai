import { STICKY_COUNTER_THRESHOLD_CHARS, STICKY_FONT_MAX_PX, STICKY_FONT_MIN_PX, STICKY_TEXT_MAX_CHARS } from '../../shared/config';
import { clampToLimit as clampToLimitAt } from '../../shared/text-edit';

/**
 * Note text helpers: the part of sticky note editing that belongs to notes and to nothing else.
 *
 * The mechanics of writing a note's text - clamping to a limit, turning a keystroke into the
 * minimal `Y.Text` operation, mapping a caret through somebody else's change - are not specific to
 * notes: a free text object (story 9) types into the same kind of `Y.Text` and only wants a
 * different character limit. Those live in `shared/text-edit.ts` and are re-exported here, with
 * the note's own limit filled in, so every story 2 caller keeps saying `clampToLimit(next)`.
 */

/** Keep at most `max` characters (the note's limit unless the caller says otherwise). */
export function clampToLimit(next: string, max: number = STICKY_TEXT_MAX_CHARS): string {
  return clampToLimitAt(next, max);
}

export {
  applyAddedText,
  applyLocalEdit,
  applyTextDiff,
  mapCaret,
  textEdit,
  type TextDeltaOp,
  type TextEdit,
} from '../../shared/text-edit';

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
