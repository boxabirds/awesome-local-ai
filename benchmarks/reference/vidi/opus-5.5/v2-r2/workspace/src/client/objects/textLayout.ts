// Pure text object layout (text.layout): greedy word wrap with a pluggable measurer.
import {
  TEXT_ESTIMATE_GLYPH_WIDTH_RATIO,
  TEXT_FONT_FAMILY,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_SIZES,
  type TextSize,
} from '../../shared/config';

/** Width of `text` in world units at `fontPx`. */
export type Measurer = (text: string, fontPx: number) => number;

/**
 * Room left after the longest line of auto-width text (world units), so the
 * caret and sub-pixel rounding never force a wrap. Never makes the box wider
 * than TEXT_MAX_AUTO_WIDTH_WORLD.
 */
export const TEXT_BOX_PADDING_WORLD = 4;

/** Measurer used when no canvas is available: average glyph width × characters. */
export const estimateMeasurer: Measurer = (text, fontPx) => text.length * fontPx * TEXT_ESTIMATE_GLYPH_WIDTH_RATIO;

type Context2D = { font: string; measureText(text: string): { width: number } };

function create2dContext(): Context2D | null {
  try {
    if (typeof OffscreenCanvas !== 'undefined') {
      const ctx = new OffscreenCanvas(1, 1).getContext('2d');
      if (ctx) return ctx;
    }
    if (typeof document !== 'undefined') {
      const ctx = document.createElement('canvas').getContext('2d');
      if (ctx) return ctx;
    }
  } catch {
    // Fall through to the estimate.
  }
  return null;
}

/**
 * Measures with a canvas 2D context in `fontFamily`; without a canvas (for
 * example jsdom or Node) it falls back to `estimateMeasurer`. Never throws.
 */
export function createCanvasMeasurer(fontFamily: string = TEXT_FONT_FAMILY): Measurer {
  let ctx: Context2D | null | undefined;
  let currentFont = '';
  return (text, fontPx) => {
    if (ctx === undefined) ctx = create2dContext();
    if (!ctx) return estimateMeasurer(text, fontPx);
    const font = `${fontPx}px ${fontFamily}`;
    if (font !== currentFont) {
      ctx.font = font;
      currentFont = font;
    }
    try {
      return ctx.measureText(text).width;
    } catch {
      return estimateMeasurer(text, fontPx);
    }
  };
}

let shared: Measurer | null = null;

/** One canvas measurer for the whole page. */
export function defaultMeasurer(): Measurer {
  shared ??= createCanvasMeasurer(TEXT_FONT_FAMILY);
  return shared;
}

/** Splits a word wider than `maxWidth` into pieces that fit (at least one character each). */
function breakWord(word: string, maxWidth: number, width: (s: string) => number): string[] {
  const pieces: string[] = [];
  let piece = '';
  for (const ch of word) {
    if (piece !== '' && width(piece + ch) > maxWidth) {
      pieces.push(piece);
      piece = ch;
    } else {
      piece += ch;
    }
  }
  if (piece !== '') pieces.push(piece);
  return pieces;
}

/**
 * Greedy word wrap of one paragraph (no newlines) at `maxWidth`, like CSS
 * `white-space: pre-wrap; overflow-wrap: anywhere`: spaces after a word hang at
 * the end of its line and do not count towards the width.
 */
function wrapParagraph(paragraph: string, maxWidth: number, width: (s: string) => number): string[] {
  if (width(paragraph.trimEnd()) <= maxWidth) return [paragraph];
  const tokens = paragraph.match(/\s*\S+\s*|\s+/g) ?? [paragraph];
  const lines: string[] = [];
  let line = '';
  for (const token of tokens) {
    const candidate = line + token;
    if (width(candidate.trimEnd()) <= maxWidth) {
      line = candidate;
      continue;
    }
    if (line !== '') lines.push(line);
    if (width(token.trimEnd()) <= maxWidth) {
      line = token;
    } else {
      const pieces = breakWord(token, maxWidth, (s) => width(s.trimEnd()));
      line = pieces.pop() ?? '';
      lines.push(...pieces);
    }
  }
  lines.push(line);
  return lines;
}

/**
 * Lays out a text object. Auto mode: as wide as the longest line (plus
 * TEXT_BOX_PADDING_WORLD) up to TEXT_MAX_AUTO_WIDTH_WORLD, wrapping lines longer
 * than that. Fixed mode: exactly `fixedWidth`, wrapping at it. Height is always
 * lines × TEXT_SIZES[size] × TEXT_LINE_HEIGHT; explicit newlines are kept.
 */
export function layoutText(
  text: string,
  size: TextSize,
  mode: 'auto' | 'fixed',
  fixedWidth: number | null,
  measure: Measurer,
): { width: number; height: number; lines: string[] } {
  const fontPx = TEXT_SIZES[size];
  const width = (s: string): number => {
    const w = measure(s, fontPx);
    return Number.isFinite(w) && w > 0 ? w : 0;
  };
  const fixed = mode === 'fixed' && fixedWidth !== null && Number.isFinite(fixedWidth) && fixedWidth > 0;
  const wrapAt = fixed ? fixedWidth : TEXT_MAX_AUTO_WIDTH_WORLD;
  const paragraphs = text.split('\n');
  const lines = paragraphs.flatMap((p) => wrapParagraph(p, wrapAt, width));
  const height = lines.length * fontPx * TEXT_LINE_HEIGHT;
  if (fixed) return { width: fixedWidth, height, lines };
  // A paragraph longer than the maximum wraps and makes the box the maximum width.
  const longest = Math.max(0, ...paragraphs.map((p) => width(p.trimEnd())));
  return { width: Math.min(TEXT_MAX_AUTO_WIDTH_WORLD, Math.ceil(longest + TEXT_BOX_PADDING_WORLD)), height, lines };
}
