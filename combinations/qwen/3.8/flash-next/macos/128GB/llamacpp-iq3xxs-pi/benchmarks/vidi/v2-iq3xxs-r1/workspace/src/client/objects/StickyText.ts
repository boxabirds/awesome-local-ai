import {
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_SIZE_WORLD,
  STICKY_TEXT_MAX_CHARS,
} from '../../shared/config';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import {
  applyTextDiff as applyTextDiffShared,
  clampToLimit as clampToLimitShared,
} from '../../shared/text-edit';

// ---------------------------------------------------------------------------
// Sticky note text helpers. Story 9 moved the shared part (the length limit and
// the minimal Yjs diff, which sticky notes and free text both need) into
// `src/shared/text-edit.ts`; the sticky-facing names are re-exported here with
// the sticky defaults, so every story 2 caller and test is unchanged.
// ---------------------------------------------------------------------------

export {
  applyRemoteDelta,
  type DeltaOp,
  type RemoteTextChange,
  type TextSelection,
} from '../../shared/text-edit';

/** `clampToLimit` for a sticky note: the limit is always STICKY_TEXT_MAX_CHARS. */
export function clampToLimit(
  next: string,
  max: number = STICKY_TEXT_MAX_CHARS,
): string {
  return clampToLimitShared(next, max);
}

/** `applyTextDiff` for a sticky note: the origin is always this client's. */
export function applyTextDiff(
  ytext: import('yjs').Text,
  next: string,
  origin: unknown = LOCAL_ORIGIN,
): void {
  applyTextDiffShared(ytext, next, origin);
}

/**
 * True when the note is within STICKY_COUNTER_THRESHOLD_CHARS of the limit and
 * the "n/1000" counter should be shown.
 */
export function counterVisible(length: number): boolean {
  const remaining = STICKY_TEXT_MAX_CHARS - length;
  return remaining <= STICKY_COUNTER_THRESHOLD_CHARS;
}

export interface FontFit {
  fontPx: number;
  overflow: boolean;
}

/**
 * Padding inside a note, in world units; mirrors `.sticky-text` in index.css.
 * A note is a square (`STICKY_SIZE_WORLD`), so one padding constant gives the
 * text box in both directions.
 */
export const STICKY_TEXT_PADDING_WORLD = 16;
export const STICKY_TEXT_BOX_WORLD = STICKY_SIZE_WORLD - STICKY_TEXT_PADDING_WORLD * 2;

/** Returns the height the note text would occupy at `fontPx`. */
export type MeasureFont = (fontPx: number) => number;

/**
 * Largest integer font size in [STICKY_FONT_MIN_PX, STICKY_FONT_MAX_PX] at
 * which the text still fits into `boxPx` (binary search over the 15 candidate
 * sizes). When even the smallest size does not fit, `overflow` is true: the
 * caller clips the text inside the note and shows the bottom fade.
 *
 * `measure(fontPx)` does the layout work, so the search itself is pure and
 * testable, and only the text and the candidate size are involved — never zoom.
 */
export function fitTextFontSize(
  text: string,
  measure: MeasureFont,
  boxPx = STICKY_TEXT_BOX_WORLD,
): FontFit {
  if (text.trim() === '') return { fontPx: STICKY_FONT_MAX_PX, overflow: false };

  const fits = (size: number): boolean => {
    // A height of 0 means "not measurable" (detached element, or jsdom, which
    // has no layout): treat that as fitting, so the maximum size is chosen.
    const height = measure(size);
    return height === 0 || height <= boxPx;
  };

  let low = STICKY_FONT_MIN_PX;
  let high = STICKY_FONT_MAX_PX;
  let best = -1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (fits(mid)) {
      best = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  if (best < 0) return { fontPx: STICKY_FONT_MIN_PX, overflow: true };
  return { fontPx: best, overflow: false };
}

/**
 * A `MeasureFont` backed by a real element: set the font size, then read the
 * height the wrapped text occupies. `getComputedStyle` is deliberately not used
 * — reading it per candidate size is far slower than `scrollHeight`.
 */
export function measureElementHeight(el: HTMLElement): MeasureFont {
  return (fontPx: number) => {
    const previous = el.style.fontSize;
    el.style.fontSize = `${fontPx}px`;
    const height = el.scrollHeight;
    if (previous) el.style.fontSize = previous;
    else el.style.removeProperty('font-size');
    return height;
  };
}

/**
 * `fitTextFontSize` for a note that is in the document: the text is read from
 * `el`, measured through `el` itself, and the chosen size is applied to `el` so
 * the measurement and the result can never disagree.
 */
export function fitFontSize(el: HTMLElement, boxPx = STICKY_TEXT_BOX_WORLD): FontFit {
  const fit = fitTextFontSize(el.textContent ?? '', measureElementHeight(el), boxPx);
  el.style.fontSize = `${fit.fontPx}px`;
  return fit;
}
