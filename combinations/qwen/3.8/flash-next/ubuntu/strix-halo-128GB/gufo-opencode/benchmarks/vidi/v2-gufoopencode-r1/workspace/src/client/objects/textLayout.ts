import {
  TEXT_FONT_FAMILY,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
  type TextSize
} from '../../shared/config';

// Story 9: text layout. See spec story 009 "Text layout and box sync".

export type Measurer = (text: string, fontPx: number) => number;

// Extra horizontal space around the measured text so glyphs never sit flush
// with the box edge. Counted in the stored width, deducted for wrapping.
export const TEXT_BOX_PADDING_WORLD = 16;

// Average glyph width as a fraction of the font size, used when no canvas is
// available to measure real font metrics.
export const TEXT_GLYPH_WIDTH_RATIO = 0.5;

function estimateWidth(text: string, fontPx: number): number {
  return text.length * fontPx * TEXT_GLYPH_WIDTH_RATIO;
}

type AnyContext = { font: string; measureText(text: string): { width: number } };

function tryCreateContext(family: string): AnyContext | null {
  try {
    if (typeof OffscreenCanvas !== 'undefined') {
      const canvas = new OffscreenCanvas(1, 1);
      const ctx = canvas.getContext('2d') as unknown as AnyContext | null;
      if (ctx !== null) {
        ctx.font = `10px ${family}`;
        return ctx;
      }
    }
  } catch {
    // fall through to the DOM canvas attempt
  }
  try {
    if (typeof document !== 'undefined') {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d') as unknown as AnyContext | null;
      if (ctx !== null) {
        ctx.font = `10px ${family}`;
        return ctx;
      }
    }
  } catch {
    // canvas unavailable: estimate instead (TC-32)
  }
  return null;
}

export function createCanvasMeasurer(fontFamily: string = TEXT_FONT_FAMILY): Measurer {
  const ctx = tryCreateContext(fontFamily);
  if (ctx === null) {
    return (text: string, fontPx: number) => estimateWidth(text, fontPx);
  }
  let currentFontPx = -1;
  return (text: string, fontPx: number) => {
    if (text.length === 0) return 0;
    if (fontPx !== currentFontPx) {
      ctx.font = `${fontPx}px ${fontFamily}`;
      currentFontPx = fontPx;
    }
    return ctx.measureText(text).width;
  };
}

// Greedy word wrap. A single word wider than the available width is kept on
// its own line rather than being split (pre-wrap clipping handles it).
function wrapLine(line: string, fontPx: number, available: number, measure: Measurer): string[] {
  if (line.length === 0) return [''];
  const words = line.split(' ');
  const out: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current.length === 0 ? word : current + ' ' + word;
    if (current.length === 0 || measure(candidate, fontPx) <= available) {
      current = candidate;
    } else {
      out.push(current);
      current = word;
    }
  }
  out.push(current);
  return out;
}

export function layoutText(
  text: string,
  size: TextSize,
  mode: 'auto' | 'fixed',
  fixedWidth: number | null,
  measure: Measurer
): { width: number; height: number; lines: string[] } {
  const fontPx = TEXT_SIZES[size];
  const paragraphs = text.split('\n');
  let width: number;
  if (mode === 'fixed') {
    const requested = fixedWidth ?? TEXT_MIN_WIDTH_WORLD;
    width = Math.max(requested, TEXT_MIN_WIDTH_WORLD);
  } else {
    let longest = 0;
    for (const paragraph of paragraphs) {
      const w = measure(paragraph, fontPx);
      if (w > longest) longest = w;
    }
    width = Math.min(longest + TEXT_BOX_PADDING_WORLD, TEXT_MAX_AUTO_WIDTH_WORLD);
  }
  const available = Math.max(width - TEXT_BOX_PADDING_WORLD, 1);
  const lines: string[] = [];
  for (const paragraph of paragraphs) {
    for (const line of wrapLine(paragraph, fontPx, available, measure)) lines.push(line);
  }
  const height = lines.length * fontPx * TEXT_LINE_HEIGHT;
  return { width, height, lines };
}
