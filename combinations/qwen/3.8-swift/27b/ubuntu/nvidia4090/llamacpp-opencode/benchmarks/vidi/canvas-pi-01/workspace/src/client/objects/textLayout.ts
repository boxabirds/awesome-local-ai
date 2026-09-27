// Pure text layout for text objects (see spec: text.layout).
//
// `layoutText` is pure: given text, size preset, width mode and a measurer it
// returns the stored box (width, height) and the wrapped lines. Auto mode:
// width = min(longest line, TEXT_MAX_AUTO_WIDTH_WORLD) with greedy word wrap
// beyond the max (text.auto_width). Fixed mode: width = the fixed width, text
// rewraps to it (text.fixed_width). Height always follows content
// (text.height): lines × size × TEXT_LINE_HEIGHT; explicit newlines are
// respected.

import {
  TEXT_AVG_GLYPH_WIDTH_RATIO,
  TEXT_FONT_FAMILY,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_SIZES,
  type TextSize,
} from '../../shared/config';

/** Measure the rendered width of `text` at `fontPx`, in world units. */
export type Measurer = (text: string, fontPx: number) => number;

/**
 * Estimate a text width as length × font size × TEXT_AVG_GLYPH_WIDTH_RATIO.
 * Used when no canvas is available (jsdom, worker, first paint) — never
 * throws (spec: measurer unavailable → estimate fallback).
 */
export function estimateTextWidth(text: string, fontPx: number): number {
  if (text.length === 0) return 0;
  return text.length * fontPx * TEXT_AVG_GLYPH_WIDTH_RATIO;
}

/**
 * A measurer backed by canvas `measureText`. Falls back to
 * estimateTextWidth when no canvas context is available (jsdom, node); the
 * returned function never throws.
 */
export function createCanvasMeasurer(fontFamily: string = TEXT_FONT_FAMILY): Measurer {
  let ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null;
  try {
    if (typeof OffscreenCanvas !== 'undefined') {
      ctx = new OffscreenCanvas(1, 1).getContext('2d');
    }
    if (ctx === null && typeof document !== 'undefined') {
      ctx = document.createElement('canvas').getContext('2d');
    }
  } catch {
    ctx = null;
  }
  return (text: string, fontPx: number): number => {
    if (text.length === 0) return 0;
    if (ctx !== null) {
      ctx.font = `${fontPx}px ${fontFamily}`;
      return ctx.measureText(text).width;
    }
    return estimateTextWidth(text, fontPx);
  };
}

/**
 * Greedy word wrap of one raw line to `maxWidth`; a single word longer than
 * the max is hard-broken so the result always fits (and loses no
 * characters). An empty line yields one empty line.
 */
function wrapLine(line: string, maxWidth: number, measure: Measurer, fontPx: number): string[] {
  if (line.length === 0) return [''];
  if (measure(line, fontPx) <= maxWidth) return [line];

  let current = '';
  let lines: string[] = [];
  for (const word of line.split(' ')) {
    if (word === '') {
      current += ' '; // preserve runs of spaces in the wrapped output
      continue;
    }
    const candidate = current === '' ? word : `${current} ${word}`;
    if (current !== '' && measure(candidate, fontPx) > maxWidth) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current !== '') lines.push(current);

  // Hard-break any line still wider than the max (a single long word).
  const out: string[] = [];
  for (const l of lines) {
    if (measure(l, fontPx) <= maxWidth) {
      out.push(l);
      continue;
    }
    let rest = l;
    while (rest.length > 0 && measure(rest, fontPx) > maxWidth) {
      // Longest prefix that fits (binary search; the measurer is monotonic).
      let lo = 1;
      let hi = rest.length;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (measure(rest.slice(0, mid), fontPx) <= maxWidth) lo = mid;
        else hi = mid - 1;
      }
      out.push(rest.slice(0, lo));
      rest = rest.slice(lo);
    }
    if (rest !== '') out.push(rest);
  }
  return out;
}

export function layoutText(
  text: string,
  size: TextSize,
  mode: 'auto' | 'fixed',
  fixedWidth: number | null,
  measure: Measurer,
): { width: number; height: number; lines: string[] } {
  const fontPx = TEXT_SIZES[size];
  const fixed = mode === 'fixed' && fixedWidth !== null && Number.isFinite(fixedWidth) && fixedWidth > 0;
  const maxWidth = fixed ? (fixedWidth as number) : TEXT_MAX_AUTO_WIDTH_WORLD;

  const rawLines = text.length === 0 ? [''] : text.split('\n');
  const lines: string[] = [];
  for (const raw of rawLines) {
    lines.push(...wrapLine(raw, maxWidth, measure, fontPx));
  }

  let width: number;
  if (fixed) {
    width = fixedWidth as number;
  } else {
    let longest = 0;
    for (const l of lines) longest = Math.max(longest, measure(l, fontPx));
    width = Math.min(longest, TEXT_MAX_AUTO_WIDTH_WORLD);
  }
  const height = lines.length * fontPx * TEXT_LINE_HEIGHT;
  return { width, height, lines };
}
