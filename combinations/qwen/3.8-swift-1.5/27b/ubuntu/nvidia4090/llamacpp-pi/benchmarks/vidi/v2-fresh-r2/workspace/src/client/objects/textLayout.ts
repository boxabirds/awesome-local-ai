/**
 * Pure text layout for free text objects (story 9, text.layout).
 *
 * `layoutText` computes the box of a text object from its content:
 *
 * - explicit newlines split the text into hard lines;
 * - auto mode: the box is as wide as the longest line, up to
 *   TEXT_MAX_AUTO_WIDTH_WORLD; longer lines wrap (greedy word wrap);
 * - fixed mode: lines wrap at the fixed width;
 * - height always follows the content: lines × size × TEXT_LINE_HEIGHT
 *   (text.height — there are no vertical handles).
 *
 * `createCanvasMeasurer` measures text with a canvas 2d context at the
 * given font size (world units == px at 100% zoom). Without a canvas
 * (jsdom, unusual browsers) it falls back to a character-count estimate so
 * layout never throws (text.auto_width error path).
 */

import {
  TEXT_FONT_FAMILY,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_SIZES,
  type TextSize,
} from '../../shared/config';

/** Measures the rendered width of `text` at `fontPx`, in world units. */
export type Measurer = (text: string, fontPx: number) => number;

export interface TextLayout {
  width: number;
  height: number;
  lines: string[];
}

/**
 * Average glyph width as a fraction of the font size, used by the estimate
 * fallback when no canvas is available.
 */
export const ESTIMATED_GLYPH_WIDTH_RATIO = 0.55;

/** Estimate a line's width from its character count (canvas unavailable). */
function estimateWidth(text: string, fontPx: number): number {
  return text.length * fontPx * ESTIMATED_GLYPH_WIDTH_RATIO;
}

/**
 * A measurer backed by a canvas 2d context, or the character-count estimate
 * when no canvas is available (never throws).
 */
export function createCanvasMeasurer(fontFamily: string = TEXT_FONT_FAMILY): Measurer {
  let ctx: (CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D) | null = null;
  try {
    if (typeof OffscreenCanvas !== 'undefined') {
      const canvas = new OffscreenCanvas(1, 1);
      ctx = canvas.getContext('2d');
    } else if (typeof document !== 'undefined' && document.createElement) {
      const canvas = document.createElement('canvas');
      ctx = canvas.getContext('2d');
    }
  } catch {
    ctx = null;
  }
  if (!ctx) return estimateWidth;

  const context = ctx;
  return (text: string, fontPx: number): number => {
    context.font = `${fontPx}px ${fontFamily}`;
    return context.measureText(text).width;
  };
}

/**
 * Test-only override for the shared measurer. Lets component tests install a
 * deterministic measurer (jsdom has no canvas, so the real one falls back to
 * an estimate). Pass null to restore the default.
 */
let testMeasurer: Measurer | null = null;
export function setTestMeasurer(m: Measurer | null): void {
  testMeasurer = m;
}

/** The measurer used by text objects: the test override, else a canvas one. */
let sharedMeasurer: Measurer | null = null;
export function resolveMeasurer(): Measurer {
  if (testMeasurer) return testMeasurer;
  if (!sharedMeasurer) sharedMeasurer = createCanvasMeasurer();
  return sharedMeasurer;
}

/**
 * Greedy word wrap of `line` so every piece measures at most `maxWidth`.
 * Words are joined by single spaces. A single word longer than `maxWidth`
 * becomes its own (overflowing) line — the rendered text then breaks it by
 * character (overflow-wrap), which the stored height tolerates.
 */
function wrapLine(line: string, maxWidth: number, measure: Measurer, fontPx: number): string[] {
  if (line.length === 0) return [''];
  if (measure(line, fontPx) <= maxWidth) return [line];

  const words = line.split(' ').filter((w) => w.length > 0);
  const result: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current === '' ? word : `${current} ${word}`;
    if (current !== '' && measure(candidate, fontPx) > maxWidth) {
      result.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current !== '') result.push(current);
  return result.length > 0 ? result : [line];
}

/**
 * Layout a text object's box.
 *
 * @param text the full text (explicit newlines respected)
 * @param size the size preset (S/M/L/XL)
 * @param mode 'auto' (grow then wrap at TEXT_MAX_AUTO_WIDTH_WORLD) or 'fixed'
 * @param fixedWidth the stored width in fixed mode (null in auto mode)
 * @param measure width measurer (canvas or estimate)
 *
 * Outputs: auto → width = min(longest line, TEXT_MAX_AUTO_WIDTH_WORLD);
 * fixed → width = fixedWidth; height = lines × TEXT_SIZES[size] ×
 * TEXT_LINE_HEIGHT.
 */
export function layoutText(
  text: string,
  size: TextSize,
  mode: 'auto' | 'fixed',
  fixedWidth: number | null,
  measure: Measurer,
): TextLayout {
  const fontPx = TEXT_SIZES[size];
  const lines: string[] = [];
  for (const rawLine of text.split('\n')) {
    if (mode === 'auto') {
      lines.push(...wrapLine(rawLine, TEXT_MAX_AUTO_WIDTH_WORLD, measure, fontPx));
    } else {
      const width = fixedWidth ?? TEXT_MAX_AUTO_WIDTH_WORLD;
      lines.push(...wrapLine(rawLine, width, measure, fontPx));
    }
  }

  let longest = 0;
  for (const line of lines) {
    if (line.length === 0) continue;
    const w = measure(line, fontPx);
    if (w > longest) longest = w;
  }

  const width = mode === 'auto' ? Math.min(longest, TEXT_MAX_AUTO_WIDTH_WORLD) : (fixedWidth ?? longest);
  const height = lines.length * fontPx * TEXT_LINE_HEIGHT;
  return { width, height, lines };
}
