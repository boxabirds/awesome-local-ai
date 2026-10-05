import {
  TEXT_SIZES,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_PADDING_WORLD,
  TEXT_FONT_FAMILY,
  TEXT_AVG_GLYPH_RATIO,
  type TextSize,
} from '../../shared/config';

/**
 * Text layout (story 9, text.layout): pure layout maths for free text
 * objects. The stored box (width/height in the doc) is always derived from
 * `layoutText`, so every client renders the same box without measuring.
 */

/** Measures the width of `text` in world units at the given font size (board units). */
export type Measurer = (text: string, fontPx: number) => number;

/** Estimate: average glyph width = font size × TEXT_AVG_GLYPH_RATIO. */
function estimateWidth(text: string, fontPx: number): number {
  return text.length * fontPx * TEXT_AVG_GLYPH_RATIO;
}

/**
 * A canvas-based measurer (OffscreenCanvas or <canvas> `measureText`). Where
 * no canvas is available (jsdom, node) it falls back to the character-count
 * estimate — it never throws.
 */
export function createCanvasMeasurer(fontFamily: string = TEXT_FONT_FAMILY): Measurer {
  // jsdom has no canvas 2d context: `getContext('2d')` returns null and logs a
  // virtual-console "jsdomError" (not a catchable exception), so skip it there
  // and use the estimate. Real browsers (e2e, prod) measure exactly.
  const isJsdom =
    typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent);
  if (isJsdom) return estimateWidth;

  let ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null;
  try {
    if (typeof OffscreenCanvas !== 'undefined') {
      ctx = new OffscreenCanvas(1, 1).getContext('2d');
    } else if (typeof document !== 'undefined') {
      ctx = document.createElement('canvas').getContext('2d');
    }
  } catch {
    ctx = null;
  }
  if (!ctx) return estimateWidth;
  return (text, fontPx) => {
    if (text.length === 0) return 0;
    ctx.font = `${fontPx}px ${fontFamily}`;
    const w = ctx.measureText(text).width;
    return Number.isFinite(w) ? w : estimateWidth(text, fontPx);
  };
}

/**
 * Greedy word wrap of one explicit line so each wrapped line measures at
 * most `maxUnits`. Words are kept intact (a single over-long word stays on
 * its own line). An empty line yields one empty line.
 */
function wrapLine(line: string, maxUnits: number, measure: Measurer, fontPx: number): string[] {
  if (line === '') return [''];
  const words = line.split(' ');
  const out: string[] = [];
  let cur = '';
  for (const word of words) {
    const candidate = cur === '' ? word : `${cur} ${word}`;
    if (cur === '' || measure(candidate, fontPx) <= maxUnits) {
      cur = candidate;
    } else {
      out.push(cur);
      cur = word;
    }
  }
  out.push(cur);
  return out;
}

/**
 * Lays out text at a size preset and width mode:
 * - explicit newlines are respected;
 * - auto mode: lines longer than TEXT_MAX_AUTO_WIDTH_WORLD wrap greedily and
 *   width = min(longest line + TEXT_PADDING_WORLD, TEXT_MAX_AUTO_WIDTH_WORLD);
 * - fixed mode: lines wrap at `fixedWidth` and width = fixedWidth;
 * - height = lines × TEXT_SIZES[size] × TEXT_LINE_HEIGHT (always).
 */
export function layoutText(
  text: string,
  size: TextSize,
  mode: 'auto' | 'fixed',
  fixedWidth: number | null,
  measure: Measurer,
): { width: number; height: number; lines: string[] } {
  const fontPx = TEXT_SIZES[size];
  const maxUnits =
    mode === 'auto' ? TEXT_MAX_AUTO_WIDTH_WORLD : (fixedWidth ?? TEXT_MAX_AUTO_WIDTH_WORLD);

  const lines: string[] = [];
  for (const raw of text.split('\n')) {
    lines.push(...wrapLine(raw, maxUnits, measure, fontPx));
  }

  let longest = 0;
  for (const l of lines) {
    const w = measure(l, fontPx);
    if (w > longest) longest = w;
  }

  const width =
    mode === 'auto'
      ? Math.min(longest + TEXT_PADDING_WORLD, TEXT_MAX_AUTO_WIDTH_WORLD)
      : maxUnits;
  const height = lines.length * fontPx * TEXT_LINE_HEIGHT;
  return { width, height, lines };
}
