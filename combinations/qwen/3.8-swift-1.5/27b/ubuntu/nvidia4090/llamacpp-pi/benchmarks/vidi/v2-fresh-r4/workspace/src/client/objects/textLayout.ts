/**
 * Pure text layout (story 9): measures wrapped lines and derives the stored
 * box (width/height) for text objects.
 *
 * - auto mode: width = min(longest measured line + padding, TEXT_MAX_AUTO_WIDTH_WORLD);
 *   lines longer than the cap are greedy word-wrapped.
 * - fixed mode: width = fixedWidth; text wraps at that width.
 * - height always follows content: lines × font size × TEXT_LINE_HEIGHT.
 */
import {
  TEXT_AVG_GLYPH_WIDTH_RATIO,
  TEXT_FONT_FAMILY,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_SIZES,
  TEXT_PADDING_X_WORLD,
  type TextSize,
} from '../../shared/config';

/** Measures a single line of text in world units at the given font size (px). */
export type Measurer = (text: string, fontPx: number) => number;

type AnyContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/**
 * Create a canvas-based measurer. Falls back to a character-count estimate
 * (average glyph width ratio) when no 2d context is available (jsdom, node,
 * old browsers) — never throws.
 */
export function createCanvasMeasurer(fontFamily: string = TEXT_FONT_FAMILY): Measurer {
  let ctx: AnyContext | null = null;
  try {
    if (typeof OffscreenCanvas !== 'undefined') {
      ctx = new OffscreenCanvas(1, 1).getContext('2d');
    } else if (typeof HTMLCanvasElement !== 'undefined') {
      ctx = new HTMLCanvasElement().getContext('2d');
    }
  } catch {
    ctx = null;
  }

  return (text: string, fontPx: number): number => {
    if (ctx) {
      ctx.font = `${fontPx}px ${fontFamily}`;
      return ctx.measureText(text).width;
    }
    return text.length * fontPx * TEXT_AVG_GLYPH_WIDTH_RATIO;
  };
}

export interface TextLayout {
  width: number;
  height: number;
  lines: string[];
}

/**
 * Greedy word wrap of `line` at `maxWidth` using `measure`. Words longer than
 * the budget are kept whole (unbreakable).
 */
function wrapLine(line: string, maxWidth: number, measure: Measurer, fontPx: number): string[] {
  const words = line.split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) return [''];

  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current === '' ? word : `${current} ${word}`;
    if (current !== '' && measure(candidate, fontPx) > maxWidth) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  lines.push(current);
  return lines;
}

/**
 * Layout text at a size preset in auto or fixed width mode.
 * Explicit newlines are respected; height always follows the content.
 */
export function layoutText(
  text: string,
  size: TextSize,
  mode: 'auto' | 'fixed',
  fixedWidth: number | null,
  measure: Measurer,
): TextLayout {
  const fontPx = TEXT_SIZES[size];
  const isFixed = mode === 'fixed' && fixedWidth != null;
  const maxWidth = isFixed ? (fixedWidth as number) : TEXT_MAX_AUTO_WIDTH_WORLD;

  const lines: string[] = [];
  for (const rawLine of text.split('\n')) {
    lines.push(...wrapLine(rawLine, maxWidth, measure, fontPx));
  }

  let longest = 0;
  for (const line of lines) {
    const w = measure(line, fontPx);
    if (w > longest) longest = w;
  }

  const width = isFixed
    ? (fixedWidth as number)
    : Math.min(longest + TEXT_PADDING_X_WORLD, TEXT_MAX_AUTO_WIDTH_WORLD);
  const height = lines.length * fontPx * TEXT_LINE_HEIGHT;

  return { width, height, lines };
}
