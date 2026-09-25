// Text object layout (text.layout): pure line breaking and box size for a given measurer, plus a canvas measurer.
// Mirrors how the text is drawn (`white-space: pre-wrap`, `overflow-wrap: anywhere`): explicit newlines break, lines
// wrap greedily at spaces, and a word longer than the line breaks between characters.
import {
  TEXT_AVG_GLYPH_WIDTH_RATIO,
  TEXT_FONT_FAMILY,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_PADDING_WORLD,
  TEXT_SIZES,
  type TextSize,
} from '../../shared/config';

/** Width of `text` set at `fontPx`, in world units (world units = px at 100% zoom). */
export type Measurer = (text: string, fontPx: number) => number;

/** Estimate used when no canvas is available: every glyph TEXT_AVG_GLYPH_WIDTH_RATIO of the font size. */
export const estimateMeasurer: Measurer = (text, fontPx) => [...text].length * fontPx * TEXT_AVG_GLYPH_WIDTH_RATIO;

type Context2D = Pick<CanvasRenderingContext2D, 'font' | 'measureText'>;

function canvasContext(): Context2D | null {
  try {
    // A document canvas resolves fonts like the page does; an OffscreenCanvas may not (Firefox measures
    // `system-ui` with another font there), so it is only the fallback outside a document.
    if (typeof document !== 'undefined') {
      // jsdom has a canvas element without a 2D context (and reports that as an error); treat it as no canvas.
      if (/jsdom/i.test(navigator.userAgent)) return null;
      return document.createElement('canvas').getContext('2d');
    }
    if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(1, 1).getContext('2d');
    return null;
  } catch {
    return null;
  }
}

/** Measures with a 2D canvas in `fontFamily`; falls back to `estimateMeasurer` where there is no canvas. */
export function createCanvasMeasurer(fontFamily: string = TEXT_FONT_FAMILY): Measurer {
  const ctx = canvasContext();
  if (!ctx) return estimateMeasurer;
  return (text, fontPx) => {
    ctx.font = `${fontPx}px ${fontFamily}`;
    return ctx.measureText(text).width;
  };
}

let shared: Measurer | null = null;

/** One canvas measurer for the page, created on first use. */
export function defaultMeasurer(): Measurer {
  shared ??= createCanvasMeasurer(TEXT_FONT_FAMILY);
  return shared;
}

/** Splits one paragraph (no newlines) into lines no wider than `maxWidth`. Trailing spaces hang, as in CSS. */
function wrapParagraph(para: string, maxWidth: number, fontPx: number, measure: Measurer): string[] {
  if (para === '') return [''];
  const fits = (s: string) => measure(s.trimEnd(), fontPx) <= maxWidth;
  const tokens = para.match(/\s+|\S+\s*/g) ?? [para];
  const lines: string[] = [];
  let current = '';
  for (const token of tokens) {
    if (fits(current + token)) {
      current += token;
      continue;
    }
    if (current !== '') lines.push(current);
    current = '';
    if (fits(token)) {
      current = token;
      continue;
    }
    // A word wider than the line: break it between characters.
    for (const ch of token) {
      if (current !== '' && !fits(current + ch)) {
        lines.push(current);
        current = '';
      }
      current += ch;
    }
  }
  lines.push(current);
  return lines;
}

/**
 * Lines and box of a text object. Auto width: as wide as the longest line (before wrapping) plus TEXT_PADDING_WORLD, at most
 * TEXT_MAX_AUTO_WIDTH_WORLD, and lines longer than that wrap. Fixed width: `fixedWidth` (at least
 * TEXT_MIN_WIDTH_WORLD), lines wrap at it. Height is always lines × font size × TEXT_LINE_HEIGHT (an empty text is
 * one line, so the caret has room).
 */
export function layoutText(
  text: string,
  size: TextSize,
  mode: 'auto' | 'fixed',
  fixedWidth: number | null,
  measure: Measurer,
): { width: number; height: number; lines: string[] } {
  const fontPx = TEXT_SIZES[size] ?? TEXT_SIZES.M;
  const safeMeasure: Measurer = (s, px) => {
    const w = measure(s, px);
    return Number.isFinite(w) && w >= 0 ? w : estimateMeasurer(s, px);
  };
  const wrapAt =
    mode === 'fixed' ? Math.max(TEXT_MIN_WIDTH_WORLD, fixedWidth ?? TEXT_MIN_WIDTH_WORLD) : TEXT_MAX_AUTO_WIDTH_WORLD;
  const paragraphs = text.split('\n');
  const lines = paragraphs.flatMap((para) => wrapParagraph(para, wrapAt, fontPx, safeMeasure));
  const height = lines.length * fontPx * TEXT_LINE_HEIGHT;
  if (mode === 'fixed') return { width: wrapAt, height, lines };
  // Measured before wrapping: a text with a wrapped line is exactly TEXT_MAX_AUTO_WIDTH_WORLD wide.
  const longest = Math.max(0, ...paragraphs.map((p) => safeMeasure(p.trimEnd(), fontPx)));
  return { width: Math.min(TEXT_MAX_AUTO_WIDTH_WORLD, Math.ceil(longest + TEXT_PADDING_WORLD)), height, lines };
}
