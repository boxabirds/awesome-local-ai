import type * as Y from 'yjs';
import {
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_TEXT_MAX_CHARS,
} from '../../shared/config';
import {
  clampToLimit as clampToSharedLimit,
  minimalDiff,
} from '../../shared/text-edit';

/**
 * Sticky note text logic (anchor `sticky.text`).
 *
 * Story 9 moved the shared half of this module - the length limit and the
 * minimal `Y.Text` diff - to `src/shared/text-edit.ts`, so a text object and a
 * sticky note cannot drift apart. What is left here is what is genuinely
 * sticky-specific: the counter threshold, the font search, the delta write that
 * uses the text the person was looking at, and the re-export of the shared
 * helpers with STICKY_TEXT_MAX_CHARS as the default limit, which is what story
 * 2's callers (and its tests) import.
 */

export { applyTextDiff, minimalDiff, type TextDiff } from '../../shared/text-edit';

/**
 * At most STICKY_TEXT_MAX_CHARS characters of `next` (`sticky.limit`): the shared
 * clamp with this type's limit as the default, so story 2's call sites are
 * unchanged.
 */
export function clampToLimit(next: string, max: number = STICKY_TEXT_MAX_CHARS): string {
  return clampToSharedLimit(next, max);
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

/**
 * The counter appears when this many characters (or fewer) are left.
 *
 * The limits default to a sticky note's, and story 9's text object passes its own:
 * the rule - a warning only when the person is close to the ceiling - is shared.
 */
export function counterVisible(
  length: number,
  max: number = STICKY_TEXT_MAX_CHARS,
  threshold: number = STICKY_COUNTER_THRESHOLD_CHARS,
): boolean {
  return max - length <= threshold;
}

export interface FontFit {
  readonly fontPx: number;
  readonly overflow: boolean;
}

/**
 * The largest integer font size (in board units, so it scales with zoom) at
 * which the element's text still fits inside `box`. When it does not fit even at
 * STICKY_FONT_MIN_PX the text stays that size and `overflow` reports that the
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


