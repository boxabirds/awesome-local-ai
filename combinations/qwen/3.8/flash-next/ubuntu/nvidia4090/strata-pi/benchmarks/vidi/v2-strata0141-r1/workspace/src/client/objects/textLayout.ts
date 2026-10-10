import {
  TEXT_BOX_PADDING_WORLD,
  TEXT_ESTIMATED_GLYPH_WIDTH_RATIO,
  TEXT_FONT_FAMILY,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
  type TextSize,
} from '../../shared/config';

/**
 * Text layout (anchor `text.layout`).
 *
 * Pure arithmetic over board units: given the words, the size preset and the
 * width mode, it answers the box a text object must have - the width automatic
 * text grows to (up to TEXT_MAX_AUTO_WIDTH_WORLD, wrapping beyond it), the width
 * fixed text is pinned to, and the height the lines need
 * (`text.auto_width`, `text.fixed_width`, `text.height`).
 *
 * Measurement is a parameter (`Measurer`), never a hidden dependency: unit tests
 * pass a fake measurer so the wrapping maths is exact, the browser passes a real
 * canvas measurer, and an environment that cannot measure at all gets an
 * estimate instead of a crash (TC-32).
 */

/** The width, in board units, of `text` drawn at `fontPx` board units. */
export type Measurer = (text: string, fontPx: number) => number;

export interface TextLayout {
  readonly width: number;
  readonly height: number;
  readonly lines: readonly string[];
}

/** A tiny tolerance: a line exactly as wide as the box is not "too wide". */
const EPSILON = 1e-6;

/** The estimate used when nothing can measure (TC-32). */
export function estimateTextWidth(text: string, fontPx: number): number {
  const length = typeof text === 'string' ? text.length : 0;
  const size = Number.isFinite(fontPx) && fontPx > 0 ? fontPx : TEXT_SIZES.M;
  return length * size * TEXT_ESTIMATED_GLYPH_WIDTH_RATIO;
}

type MeasureContext = {
  font: string;
  measureText: (text: string) => { width: number };
};

/** A 2D context to measure with, or `null` when this environment has none. */
function measureContext(): MeasureContext | null {
  const createCanvas = (): HTMLCanvasElement | OffscreenCanvas | null => {
    try {
      const globalOffscreen = (
        globalThis as { OffscreenCanvas?: new (width: number, height: number) => OffscreenCanvas }
      ).OffscreenCanvas;
      if (globalOffscreen) {
        return new globalOffscreen(1, 1);
      }
      const doc = (globalThis as { document?: Document }).document;
      if (doc && typeof doc.createElement === 'function') {
        return doc.createElement('canvas');
      }
    } catch {
      return null;
    }
    return null;
  };

  try {
    const canvas = createCanvas();
    const context = canvas?.getContext?.('2d') as MeasureContext | null;
    return context && typeof context.measureText === 'function' ? context : null;
  } catch {
    return null;
  }
}

/**
 * A measurer backed by a real canvas, so wrapping matches what the browser draws.
 * Without a canvas - a Worker, a node run, jsdom with no canvas implementation -
 * it degrades to the character-count estimate and never throws (TC-32).
 */
export function createCanvasMeasurer(fontFamily: string = TEXT_FONT_FAMILY): Measurer {
  const context = measureContext();
  if (!context) {
    return estimateTextWidth;
  }
  return (text: string, fontPx: number): number => {
    try {
      context.font = `${fontPx}px ${fontFamily}`;
      const width = context.measureText(text).width;
      return Number.isFinite(width) && width >= 0 ? width : estimateTextWidth(text, fontPx);
    } catch {
      return estimateTextWidth(text, fontPx);
    }
  };
}

/** A measurer that cannot fail: nonsense out becomes the estimate. */
const safeMeasure = (measure: Measurer, text: string, fontPx: number): number => {
  try {
    const width = measure(text, fontPx);
    return Number.isFinite(width) && width >= 0 ? width : estimateTextWidth(text, fontPx);
  } catch {
    return estimateTextWidth(text, fontPx);
  }
};

/**
 * This environment's measurer, made once.
 *
 * A canvas per text object would be wasteful - a board can hold hundreds - and a
 * canvas context costs nothing to reuse, because the font is set per measurement.
 * A test that wants exact numbers passes its own measurer instead (`text.layout`).
 */
let SHARED_MEASURER: Measurer | null = null;

export function sharedMeasurer(): Measurer {
  if (!SHARED_MEASURER) {
    SHARED_MEASURER = createCanvasMeasurer();
  }
  return SHARED_MEASURER;
}

/**
 * Greedy word wrap: as many whole words as fit in `maxWidth`, then a new line. A
 * single word wider than the box gets a line of its own - cutting words in the
 * middle is not wrapping.
 */
function wrapParagraph(paragraph: string, maxWidth: number, measureLine: (line: string) => number): string[] {
  if (paragraph.length === 0) {
    return [''];
  }
  const words = paragraph.split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current.length === 0 ? word : `${current} ${word}`;
    if (current.length > 0 && measureLine(candidate) > maxWidth + EPSILON) {
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
 * The box for `text` (`text.layout`).
 *
 * - automatic: as wide as the longest line, up to TEXT_MAX_AUTO_WIDTH_WORLD
 *   (plus a little slack, itself capped by the maximum), wrapping beyond it;
 * - fixed: exactly `fixedWidth`, never narrower than TEXT_MIN_WIDTH_WORLD;
 * - height: always the number of lines it takes, never an independent number
 *   (`text.height` - there are no vertical handles).
 */
export function layoutText(
  text: string,
  size: TextSize,
  mode: 'auto' | 'fixed',
  fixedWidth: number | null,
  measure: Measurer,
): TextLayout {
  const fontPx = TEXT_SIZES[size] ?? TEXT_SIZES.M;
  const source = typeof text === 'string' ? text : '';
  const measureLine = (line: string): number => safeMeasure(measure, line, fontPx);

  const paragraphs = source.split('\n');
  const usableFixed =
    mode === 'fixed' && typeof fixedWidth === 'number' && Number.isFinite(fixedWidth)
      ? Math.max(fixedWidth, TEXT_MIN_WIDTH_WORLD)
      : null;

  let contentWidth: number;
  if (usableFixed !== null) {
    contentWidth = usableFixed;
  } else {
    let longest = 0;
    for (const paragraph of paragraphs) {
      longest = Math.max(longest, measureLine(paragraph));
    }
    contentWidth = Math.min(longest, TEXT_MAX_AUTO_WIDTH_WORLD);
  }

  const lines: string[] = [];
  for (const paragraph of paragraphs) {
    lines.push(...wrapParagraph(paragraph, contentWidth, measureLine));
  }

  const width =
    usableFixed !== null
      ? usableFixed
      : Math.max(
          Math.min(contentWidth + TEXT_BOX_PADDING_WORLD, TEXT_MAX_AUTO_WIDTH_WORLD),
          TEXT_MIN_WIDTH_WORLD,
        );
  const height = lines.length * fontPx * TEXT_LINE_HEIGHT;

  return { width, height, lines };
}
