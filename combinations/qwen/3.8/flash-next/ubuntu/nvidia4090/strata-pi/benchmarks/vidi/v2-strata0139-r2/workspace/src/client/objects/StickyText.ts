import type { CSSProperties } from "react";
import type * as Y from "yjs";
import {
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_TEXT_MAX_CHARS,
  STICKY_TEXT_PADDING_WORLD,
} from "../../shared/config";
import {
  applyTextDiff as applyTextDiffShared,
  clampToLimit as clampToLimitShared,
} from "../../shared/text-edit";

/**
 * Sticky note text logic (`sticky.text`).
 *
 * Pure, testable pieces of note editing: the length limit, the minimal
 * textarea -> Y.Text diff, the counter rule and the font auto-fit. The React
 * editor component (`StickyTextEditor.tsx`) is only glue around these.
 *
 * The clamp and the diff writer moved to `src/shared/text-edit.ts` in story 9,
 * where text objects share them; they are re-exported here with the note limit
 * so story 2's callers are unchanged.
 */

export { commonPrefixLength, commonSuffixLength } from "../../shared/text-edit";

/** Drops every character beyond `max` (default `STICKY_TEXT_MAX_CHARS`). */
export function clampToLimit(next: string, max = STICKY_TEXT_MAX_CHARS): string {
  return clampToLimitShared(next, max);
}

/**
 * Writes `next` into `ytext` with the smallest possible change: common prefix
 * and common suffix are left alone, so a single typed character stays a single
 * insert and text typed concurrently by someone else is never destroyed.
 *
 * Surrogate-safe, and like every text write it is one transaction per input
 * event (nested calls join the open transaction).
 */
export function applyTextDiff(
  ytext: Y.Text,
  next: string,
  origin: unknown,
  max = STICKY_TEXT_MAX_CHARS,
): void {
  applyTextDiffShared(ytext, next, origin, max);
}

/** True when `length` leaves `STICKY_COUNTER_THRESHOLD_CHARS` or fewer to type. */
export function counterVisible(length: number): boolean {
  if (!Number.isFinite(length)) return false;
  return STICKY_TEXT_MAX_CHARS - length <= STICKY_COUNTER_THRESHOLD_CHARS;
}

export interface FontFit {
  /** Largest size in [STICKY_FONT_MIN_PX, STICKY_FONT_MAX_PX] that fits. */
  readonly fontPx: number;
  /** True when even the smallest size does not fit: show the bottom fade. */
  readonly overflow: boolean;
}

/**
 * Binary-searches the largest integer font size whose text fits in `box`
 * (the element's own border-box height, in board units).
 *
 * The element keeps its final size in `style.fontSize`, so the measurement is
 * also the applied style. The font size is in board units, which is why it
 * scales with the board zoom and only ever needs measuring at one zoom.
 */
export function fitFontSize(el: HTMLElement, box: number): FontFit {
  if (!Number.isFinite(box) || box <= 0) {
    return { fontPx: STICKY_FONT_MAX_PX, overflow: false };
  }

  const fitsAt = (size: number): boolean => {
    el.style.fontSize = `${size}px`;
    return el.scrollHeight <= box;
  };

  let result: FontFit;
  if (fitsAt(STICKY_FONT_MAX_PX)) {
    result = { fontPx: STICKY_FONT_MAX_PX, overflow: false };
  } else if (!fitsAt(STICKY_FONT_MIN_PX)) {
    result = { fontPx: STICKY_FONT_MIN_PX, overflow: true };
  } else {
    let low = STICKY_FONT_MIN_PX;
    let high = STICKY_FONT_MAX_PX;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (fitsAt(mid)) low = mid;
      else high = mid - 1;
    }
    result = { fontPx: low, overflow: false };
  }

  el.style.fontSize = `${result.fontPx}px`;
  return result;
}

// ---- internals ------------------------------------------------------------

/**
 * Positions a note's text box from the board settings, so the stylesheet does
 * not repeat a board measurement: the box is the note inset by
 * STICKY_TEXT_PADDING_WORLD on every side (= STICKY_TEXT_BOX_WORLD), and its
 * `scrollHeight` is what `fitFontSize` compares against that box.
 */
export function textBoxStyle(extra?: CSSProperties): CSSProperties {
  return {
    top: STICKY_TEXT_PADDING_WORLD,
    right: STICKY_TEXT_PADDING_WORLD,
    bottom: STICKY_TEXT_PADDING_WORLD,
    left: STICKY_TEXT_PADDING_WORLD,
    ...(extra ?? {}),
  };
}
