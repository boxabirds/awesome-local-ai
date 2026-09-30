/**
 * Story 9: text layout — pure, dependency-free geometry.
 *
 * `layoutText` computes the stored box (width/height) from the content,
 * the size preset and the width mode. It is pure so unit tests pass a
 * fake measurer; the production measurer wraps canvas `measureText` and
 * falls back to an average-glyph estimate where no canvas exists
 * (node, jsdom, TC-32).
 */
import {
  TEXT_SIZES, TEXT_MAX_AUTO_WIDTH_WORLD, TEXT_MIN_WIDTH_WORLD,
  TEXT_LINE_HEIGHT, TEXT_FONT_FAMILY, type TextSize,
} from '@shared/config';

/** Measure a string's rendered width in world units at `fontPx`. */
export type Measurer = (text: string, fontPx: number) => number;

/** Average glyph width as a fraction of the font size (estimate fallback). */
export const TEXT_ESTIMATE_GLYPH_RATIO = 0.5;

/** Estimate a string's width without a canvas: chars × fontPx × ratio. */
export function estimateTextWidth(text: string, fontPx: number): number {
  return text.length * fontPx * TEXT_ESTIMATE_GLYPH_RATIO;
}

/**
 * Greedy word wrap of one explicit line into lines of at most `maxWidth`
 * measured units. A single word wider than `maxWidth` takes a line of its
 * own (it is not split mid-word).
 */
function wrapLine(line: string, maxWidth: number, measure: Measurer, fontPx: number): string[] {
  if (line === '') return [''];
  const words = line.split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current === '' ? word : `${current} ${word}`;
    if (measure(candidate, fontPx) <= maxWidth || current === '') {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  lines.push(current);
  return lines;
}

/**
 * Compute the stored box for a text object.
 *
 * - auto mode: width = min(longest wrapped line, TEXT_MAX_AUTO_WIDTH_WORLD);
 *   greedy word wrap beyond that width.
 * - fixed mode: width = the fixed width (already clamped ≥ TEXT_MIN_WIDTH_WORLD
 *   by setTextWidthFixed); wrap at that width.
 * - height is ALWAYS derived: lines × fontPx × TEXT_LINE_HEIGHT.
 *
 * `fixedWidth` is ignored in auto mode (pass null).
 */
export function layoutText(
  text: string,
  size: TextSize,
  mode: 'auto' | 'fixed',
  fixedWidth: number | null,
  measure: Measurer,
): { width: number; height: number; lines: string[] } {
  const fontPx = TEXT_SIZES[size];
  const maxWidth = mode === 'fixed'
    ? Math.max(TEXT_MIN_WIDTH_WORLD, fixedWidth ?? TEXT_MIN_WIDTH_WORLD)
    : TEXT_MAX_AUTO_WIDTH_WORLD;

  const explicitLines = text.split('\n');
  const lines: string[] = [];
  for (const explicitLine of explicitLines) {
    lines.push(...wrapLine(explicitLine, maxWidth, measure, fontPx));
  }
  if (lines.length === 0) lines.push('');

  // Auto width: the longest explicit (pre-wrap) line, capped at the max
  // auto width — a line that wrapped because it hit the cap gets a box at
  // the cap (TC-08).
  let longest = 0;
  for (const explicitLine of explicitLines) {
    if (explicitLine !== '') {
      const w = measure(explicitLine, fontPx);
      if (w > longest) longest = w;
    }
  }

  const width = mode === 'fixed'
    ? maxWidth
    : Math.min(longest, TEXT_MAX_AUTO_WIDTH_WORLD);
  const height = lines.length * fontPx * TEXT_LINE_HEIGHT;

  return { width, height, lines };
}

/**
 * Production measurer: canvas `measureText`. In environments without a
 * canvas (node, jsdom) it falls back to the estimate and never throws
 * (TC-32).
 */
export function createCanvasMeasurer(fontFamily?: string): Measurer {
  const family = fontFamily ?? TEXT_FONT_FAMILY;
  let ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null;
  try {
    if (typeof OffscreenCanvas !== 'undefined') {
      ctx = new OffscreenCanvas(8, 8).getContext('2d');
    } else if (typeof document !== 'undefined') {
      ctx = document.createElement('canvas').getContext('2d');
    }
  } catch {
    ctx = null;
  }
  if (!ctx) {
    return (text, fontPx) => estimateTextWidth(text, fontPx);
  }
  return (text, fontPx) => {
    ctx.font = `${fontPx}px ${family}`;
    return ctx.measureText(text).width;
  };
}

/** Module-level production measurer (shared by TextObject and Board). */
export const defaultMeasurer: Measurer = createCanvasMeasurer();
