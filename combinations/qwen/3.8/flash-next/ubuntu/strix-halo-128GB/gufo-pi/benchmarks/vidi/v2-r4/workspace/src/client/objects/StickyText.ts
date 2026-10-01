/**
 * Sticky note text helpers: length clamping, minimal Y.Text diffs, the counter
 * visibility rule and font auto-fit. Pure logic where possible; `fitFontSize`
 * measures a real element (layout exists only in a browser).
 */
import type * as Y from 'yjs';
import {
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_TEXT_MAX_CHARS,
} from '../../shared/config';

/** Keep at most `max` characters, never cutting a surrogate pair in half. */
export function clampToLimit(next: string, max: number = STICKY_TEXT_MAX_CHARS): string {
  if (next.length <= max) return next;
  let cut = max;
  // If the character just before the cut is a high surrogate, its pair would
  // be split; drop it.
  const code = next.charCodeAt(cut - 1);
  if (code >= 0xd800 && code <= 0xdbff) cut -= 1;
  return next.slice(0, cut);
}

/**
 * Write `next` into `ytext` with the minimal change: one delete and/or one
 * insert of the region between the common prefix and the common suffix. A full
 * replace would destroy concurrent typing (story 3), so the diff matters.
 *
 * The diff runs on Unicode code points, so a surrogate pair is never cut in
 * half by the shared prefix/suffix boundary.
 */
export function applyTextDiff(ytext: Y.Text, next: string, origin: unknown): void {
  const current = ytext.toString();
  if (current === next) return;
  const before = Array.from(current);
  const after = Array.from(next);

  let prefix = 0;
  const maxPrefix = Math.min(before.length, after.length);
  while (prefix < maxPrefix && before[prefix] === after[prefix]) prefix += 1;

  let suffix = 0;
  const maxSuffix = maxPrefix - prefix;
  while (
    suffix < maxSuffix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  const inserted = after.slice(prefix, after.length - suffix).join('');
  // Code-point index -> UTF-16 offset (Yjs indexes are UTF-16 code units).
  const offset = before.slice(0, prefix).join('').length;
  const removedUnits = before.slice(prefix, before.length - suffix).join('').length;

  const doc = ytext.doc;
  const apply = () => {
    if (removedUnits > 0) ytext.delete(offset, removedUnits);
    if (inserted.length > 0) ytext.insert(offset, inserted);
  };
  if (doc) doc.transact(apply, origin);
  else apply();
}

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
