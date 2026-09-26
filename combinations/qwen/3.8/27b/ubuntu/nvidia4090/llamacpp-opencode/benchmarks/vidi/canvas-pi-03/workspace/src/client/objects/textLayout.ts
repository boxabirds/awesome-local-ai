import {
  TEXT_FONT_FAMILY,
  TEXT_GLYPH_WIDTH_RATIO,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
} from '@/shared/config';

/**
 * Text layout (story 9, text.layout). Pure: given the content, the size
 * preset, the width mode and a width measurer, computes the box
 * { width, height } stored on the object and the wrapped lines.
 *
 * - auto mode: width = min(longest line + 2 * padding, TEXT_MAX_AUTO_WIDTH_WORLD);
 *   any line wider than the box is greedy word-wrapped (long words break).
 * - fixed mode: width = fixed width (>= TEXT_MIN_WIDTH_WORLD); lines wrap at it.
 * - height = lines * TEXT_SIZES[size] * TEXT_LINE_HEIGHT.
 * - Explicit newlines are always respected.
 */

/** Measures the width of `text` at `fontPx` in world units. */
export type Measurer = (text: string, fontPx: number) => number;

/** Padding (world units) between the text and the box edge in auto mode. */
export const TEXT_PADDING_WORLD = 4;

function estimate(text: string, fontPx: number): number {
  return text.length * fontPx * TEXT_GLYPH_WIDTH_RATIO;
}

/**
 * Width measurer backed by a 2d canvas (OffscreenCanvas when available).
 * Falls back to the character-count estimate when no canvas exists (node,
 * jsdom without the `canvas` package) — it never throws (layout.width).
 */
export function createCanvasMeasurer(fontFamily: string = TEXT_FONT_FAMILY): Measurer {
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
  if (ctx === null || ctx === undefined) {
    return (text: string, fontPx: number) => estimate(text, fontPx);
  }
  return (text: string, fontPx: number): number => {
    ctx.font = `${fontPx}px ${fontFamily}`;
    return ctx.measureText(text).width;
  };
}

export interface TextLayout {
  width: number;
  height: number;
  lines: string[];
}

/**
 * Greedy word wrap of one line at `boxWidth` (world units). Long words that
 * do not fit are broken character-by-character (mirrors CSS
 * `word-break: break-word` used by the renderer). An empty line yields one
 * empty line (the explicit newline is preserved).
 */
function wrapLineToWidth(line: string, boxWidth: number, measure: Measurer, fontPx: number): string[] {
  if (line === '' || boxWidth <= 0 || measure(line, fontPx) <= boxWidth) {
    return [line];
  }
  const words = line.split(' ');
  const out: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current === '' ? word : `${current} ${word}`;
    if (measure(candidate, fontPx) <= boxWidth) {
      current = candidate;
      continue;
    }
    if (current !== '') {
      out.push(current);
      current = '';
    }
    // The word alone is wider than the box: break it.
    if (measure(word, fontPx) <= boxWidth) {
      current = word;
    } else {
      let piece = '';
      for (const ch of word) {
        const next = piece === '' ? ch : `${piece}${ch}`;
        if (measure(next, fontPx) <= boxWidth) {
          piece = next;
        } else {
          out.push(piece);
          piece = ch;
        }
      }
      current = piece;
    }
  }
  out.push(current);
  return out;
}

/**
 * Computes the layout of `text` (see module docs). `fixedWidth` is used only
 * in fixed mode; a non-positive/stale value falls back to
 * TEXT_MIN_WIDTH_WORLD. Empty content yields a degenerate 0x0 box.
 */
export function layoutText(
  text: string,
  size: string,
  mode: 'auto' | 'fixed',
  fixedWidth: number | null,
  measure: Measurer,
): TextLayout {
  const fontPx = TEXT_SIZES[size as keyof typeof TEXT_SIZES] ?? TEXT_SIZES['M'];
  if (text === '') {
    return { width: 0, height: 0, lines: [] };
  }

  let boxWidth: number;
  if (mode === 'auto') {
    let longest = 0;
    for (const line of text.split('\n')) {
      longest = Math.max(longest, measure(line, fontPx));
    }
    boxWidth = Math.min(longest + 2 * TEXT_PADDING_WORLD, TEXT_MAX_AUTO_WIDTH_WORLD);
  } else {
    boxWidth =
      fixedWidth !== null && Number.isFinite(fixedWidth) && fixedWidth > 0
        ? fixedWidth
        : TEXT_MIN_WIDTH_WORLD;
  }
  boxWidth = Math.max(boxWidth, 0);

  const lines: string[] = [];
  for (const line of text.split('\n')) {
    lines.push(...wrapLineToWidth(line, boxWidth, measure, fontPx));
  }
  const height = lines.length * fontPx * TEXT_LINE_HEIGHT;
  return { width: boxWidth, height, lines };
}
