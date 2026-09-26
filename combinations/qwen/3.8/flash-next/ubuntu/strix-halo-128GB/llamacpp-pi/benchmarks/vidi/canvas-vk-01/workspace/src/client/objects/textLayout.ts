import type { TextSize } from '../../shared/config';
import {
  TEXT_LINE_HEIGHT,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_SIZES,
  TEXT_WIDTH_PADDING_WORLD,
} from '../../shared/config';
import { estimateTextWidth } from '../../shared/objects/text';

/** Measures the rendered width of `text` at `fontPx`, in world units. */
export type Measurer = (text: string, fontPx: number) => number;

/**
 * Wrap `text` at the layout width and return the stored box.
 *
 * Auto mode: the box hugs the longest line (plus padding) until it reaches
 * TEXT_MAX_AUTO_WIDTH_WORLD, then lines wrap and the box stays at the
 * maximum. Fixed mode (a width dragged from a side handle): lines wrap at
 * exactly that width and the box never grows.
 *
 * Wrapping is greedy on spaces, like the browser; a single word wider than
 * the box gets a line of its own. Explicit newlines always break lines.
 */
export function layoutText(
  text: string,
  size: TextSize,
  mode: 'auto' | 'fixed',
  fixedWidth: number | null,
  measure: Measurer,
): { width: number; height: number; lines: string[] } {
  const fontPx = TEXT_SIZES[size];
  const isFixed =
    mode === 'fixed' && fixedWidth !== null && Number.isFinite(fixedWidth) && fixedWidth > 0;
  const maxWidth = isFixed ? (fixedWidth as number) : TEXT_MAX_AUTO_WIDTH_WORLD;

  const lines: string[] = [];
  let wrapped = false;
  for (const paragraph of text.split('\n')) {
    if (measure(paragraph, fontPx) <= maxWidth) {
      lines.push(paragraph);
      continue;
    }
    wrapped = true;
    wrapGreedy(paragraph, fontPx, maxWidth, measure, lines);
  }

  let longest = 0;
  for (const line of lines) {
    longest = Math.max(longest, measure(line, fontPx));
  }
  const width = isFixed
    ? maxWidth
    : wrapped
      ? TEXT_MAX_AUTO_WIDTH_WORLD
      : Math.min(longest + TEXT_WIDTH_PADDING_WORLD, TEXT_MAX_AUTO_WIDTH_WORLD);
  const height = lines.length * fontPx * TEXT_LINE_HEIGHT;
  return { width, height, lines };
}

/** Greedy word wrap of one over-wide line; appends the wrapped lines. */
function wrapGreedy(
  line: string,
  fontPx: number,
  maxWidth: number,
  measure: Measurer,
  out: string[],
): void {
  let current = '';
  for (const word of line.split(' ')) {
    const candidate = current === '' ? word : `${current} ${word}`;
    if (current === '' || measure(candidate, fontPx) <= maxWidth) {
      current = candidate;
    } else {
      out.push(current);
      current = word;
    }
  }
  out.push(current);
}

/**
 * A measurer backed by a 2D canvas, or by the documented character-count
 * estimate when no canvas is available (server, jsdom). Never throws.
 */
export function createCanvasMeasurer(fontFamily: string): Measurer {
  let ctx: CanvasRenderingContext2D | null = null;
  try {
    if (typeof document !== 'undefined') {
      const canvas = document.createElement('canvas');
      ctx = canvas.getContext('2d');
      if (ctx) {
        // The font shorthand needs a size; measureText only cares about the
        // font, which is set per call with the requested size anyway.
        ctx.font = `12px ${fontFamily}`;
      }
    }
  } catch {
    ctx = null;
  }
  if (ctx === null) {
    return estimateTextWidth;
  }
  const context = ctx;
  return (text, fontPx) => {
    context.font = `${fontPx}px ${fontFamily}`;
    return context.measureText(text).width;
  };
}
