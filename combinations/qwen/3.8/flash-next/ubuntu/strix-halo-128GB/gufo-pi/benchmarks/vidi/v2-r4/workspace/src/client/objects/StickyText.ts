/**
 * Sticky note text helpers: length clamping, minimal Y.Text diffs, the counter
 * visibility rule and font auto-fit. Pure logic where possible; `fitFontSize`
 * measures a real element (layout exists only in a browser).
 */
import {
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_TEXT_MAX_CHARS,
} from '../../shared/config';
import { clampToLimit as _clampToLimit, applyTextDiff as _applyTextDiff } from '../../shared/text-edit';

/** Keep at most `max` characters (defaults to STICKY_TEXT_MAX_CHARS). */
export function clampToLimit(next: string, max: number = STICKY_TEXT_MAX_CHARS): string {
  return _clampToLimit(next, max);
}

export const applyTextDiff = _applyTextDiff;

/** The character counter appears once this many characters (or fewer) remain. */
export function counterVisible(length: number): boolean {
  return STICKY_TEXT_MAX_CHARS - length <= STICKY_COUNTER_THRESHOLD_CHARS;
}

/** The box a piece of text needs at a given font size. */
export interface TextExtent {
  width: number;
  height: number;
}

export type TextMeasurer = (text: string, fontPx: number) => TextExtent;

export interface FontFit {
  fontPx: number;
  overflow: boolean;
}

/**
 * Pure auto-fit: the largest integer size in [minPx, maxPx] for which the
 * measured text fits `box`, or minPx with `overflow` when it does not fit at
 * all (the caller then clips and fades). Layout only exists in a browser, so
 * the measuring is injected — unit tests pass a stand-in.
 */
export function autoFitFontSize(
  text: string,
  measure: TextMeasurer,
  boxWidth: number,
  boxHeight: number,
  minPx = STICKY_FONT_MIN_PX,
  maxPx = STICKY_FONT_MAX_PX,
): FontFit {
  if (boxWidth <= 0 || boxHeight <= 0) return { fontPx: minPx, overflow: true };
  const fits = (size: number): boolean => {
    const extent = measure(text, size);
    return extent.width <= boxWidth + 0.5 && extent.height <= boxHeight + 0.5;
  };
  if (fits(maxPx)) return { fontPx: maxPx, overflow: false };
  if (!fits(minPx)) return { fontPx: minPx, overflow: true };
  // Binary search the largest fitting size: MIN fits, MAX does not.
  let low = minPx;
  let high = maxPx;
  while (high - low > 1) {
    const mid = Math.floor((low + high) / 2);
    if (fits(mid)) low = mid;
    else high = mid;
  }
  return { fontPx: low, overflow: false };
}

/**
 * Auto-fit with real layout: `el` is the element that paints the note text.
 * Its scroll box is compared against its own client box — which includes the
 * element's padding, so a wrapping block only reports a larger scroll box when
 * the text really spills. Comparing a padded scroll box against an unpadded
 * text box instead (the literal `box` argument) reports overflow that is only
 * padding, so `box` is optional and defaults to the element's own height.
 *
 * Mutates `el.style.fontSize` while measuring and leaves it at the result.
 */
export function fitFontSize(el: HTMLElement, box?: number): FontFit {
  const measure: TextMeasurer = (text, size) => {
    el.style.fontSize = `${size}px`;
    void text; // the element already holds the text being measured
    return { width: el.scrollWidth, height: el.scrollHeight };
  };
  return autoFitFontSize(
    el.textContent ?? '',
    measure,
    el.clientWidth,
    box ?? el.clientHeight,
  );
}
