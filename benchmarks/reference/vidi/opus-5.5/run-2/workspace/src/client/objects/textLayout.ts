/**
 * Pure layout of free text (anchor: text.layout): explicit newlines, greedy word wrap and
 * the box a text object needs.
 *
 * - Auto width: width = longest line (+ TEXT_AUTO_WIDTH_PADDING_WORLD), at most
 *   TEXT_MAX_AUTO_WIDTH_WORLD; lines longer than that wrap and the box is then exactly
 *   TEXT_MAX_AUTO_WIDTH_WORLD wide.
 * - Fixed width: lines wrap at the fixed width; width = the fixed width.
 * - Height always follows the content: lines × font size × TEXT_LINE_HEIGHT.
 *
 * Words longer than the wrap width break between characters (never inside a surrogate
 * pair). Spaces at a wrap point stay at the end of the line and do not count towards its
 * width, as in the browser's own `pre-wrap` layout.
 */
import {
  TEXT_AUTO_WIDTH_PADDING_WORLD,
  TEXT_AVG_GLYPH_WIDTH_RATIO,
  TEXT_FONT_FAMILY,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
  type TextSize,
} from '../../shared/config';

/** Width of `text` on one line at `fontPx`, in world units. */
export type Measurer = (text: string, fontPx: number) => number;

export interface TextLayout {
  width: number;
  height: number;
  lines: string[];
}

/** Estimate used where text cannot be measured (no canvas): average glyph width. */
export const estimateMeasurer: Measurer = (text, fontPx) => Array.from(text).length * fontPx * TEXT_AVG_GLYPH_WIDTH_RATIO;

interface MeasureContext {
  font: string;
  measureText(text: string): { width: number };
}

/**
 * Measures with an OffscreenCanvas 2D context in `fontFamily`; falls back to
 * `estimateMeasurer` where there is none (jsdom, Node, very old browsers). Never throws.
 */
export function createCanvasMeasurer(fontFamily: string = TEXT_FONT_FAMILY): Measurer {
  let ctx: MeasureContext | null = null;
  try {
    if (typeof OffscreenCanvas !== 'undefined') {
      ctx = new OffscreenCanvas(1, 1).getContext('2d') as MeasureContext | null;
    }
  } catch {
    ctx = null;
  }
  if (ctx === null) return estimateMeasurer;
  const c = ctx;
  let currentPx = -1;
  return (text, fontPx) => {
    if (fontPx !== currentPx) {
      c.font = `${fontPx}px ${fontFamily}`;
      currentPx = fontPx;
    }
    try {
      return c.measureText(text).width;
    } catch {
      return estimateMeasurer(text, fontPx);
    }
  };
}

let shared: Measurer | null = null;

/** The app's measurer (created on first use). */
export function defaultMeasurer(): Measurer {
  shared ??= createCanvasMeasurer();
  return shared;
}

const TRAILING_SPACE = /\s+$/u;

function visibleWidth(line: string, fontPx: number, measure: Measurer): number {
  return measure(line.replace(TRAILING_SPACE, ''), fontPx);
}

/** Greedy word wrap of one paragraph (no newlines) at `max`. */
function wrapParagraph(paragraph: string, max: number, fontPx: number, measure: Measurer): string[] {
  if (visibleWidth(paragraph, fontPx, measure) <= max) return [paragraph];
  // Each token is a word with the spaces after it (leading spaces stay with the first word).
  const tokens = paragraph.match(/\s*\S+\s*/gu) ?? [paragraph];
  const lines: string[] = [];
  let current = '';
  for (const token of tokens) {
    const candidate = current + token;
    if (visibleWidth(candidate, fontPx, measure) <= max) {
      current = candidate;
      continue;
    }
    if (current !== '') lines.push(current);
    current = '';
    if (visibleWidth(token, fontPx, measure) <= max) {
      current = token;
      continue;
    }
    // A word wider than the line: break between characters.
    for (const ch of Array.from(token)) {
      if (current !== '' && visibleWidth(current + ch, fontPx, measure) > max) {
        lines.push(current);
        current = ch;
      } else {
        current += ch;
      }
    }
  }
  if (current !== '' || lines.length === 0) lines.push(current);
  return lines;
}

export function layoutText(
  text: string,
  size: TextSize,
  mode: 'auto' | 'fixed',
  fixedWidth: number | null,
  measure: Measurer,
): TextLayout {
  const fontPx = TEXT_SIZES[size];
  const fixed = mode === 'fixed' && fixedWidth !== null && Number.isFinite(fixedWidth);
  const wrapAt = fixed ? Math.max(fixedWidth, TEXT_MIN_WIDTH_WORLD) : TEXT_MAX_AUTO_WIDTH_WORLD;
  const lines: string[] = [];
  let wrapped = false;
  for (const paragraph of text.split('\n')) {
    const parts = wrapParagraph(paragraph, wrapAt, fontPx, measure);
    if (parts.length > 1) wrapped = true;
    lines.push(...parts);
  }
  const height = lines.length * fontPx * TEXT_LINE_HEIGHT;
  if (fixed) return { width: wrapAt, height, lines };
  // Text that had to wrap uses the whole maximum width (a wrapping paragraph fills it).
  if (wrapped) return { width: TEXT_MAX_AUTO_WIDTH_WORLD, height, lines };
  const longest = lines.reduce((w, line) => Math.max(w, measure(line, fontPx)), 0);
  const width = Math.min(longest + TEXT_AUTO_WIDTH_PADDING_WORLD, TEXT_MAX_AUTO_WIDTH_WORLD);
  return { width, height, lines };
}
