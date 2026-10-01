import {
  TEXT_SIZES,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_LINE_HEIGHT,
  TEXT_FONT_FAMILY,
  TEXT_PADDING_WORLD,
  TEXT_AVG_GLYPH_FRACTION,
  type TextSize,
} from '../../shared/config';

/**
 * Pure text layout for free text objects (story 9, text.layout).
 *
 * All dimensions are in world units. The measurer is injectable so unit
 * tests can use a deterministic fake (fixed px per character) while the app
 * uses a canvas measurer with the real font.
 */

/** Returns the rendered width of `text` at `fontPx`, in world units. */
export type Measurer = (text: string, fontPx: number) => number;

/**
 * Canvas-based measurer. Falls back to a character-count estimate when no
 * 2d context is available (jsdom, SSR) — it never throws (TC-32).
 */
export function createCanvasMeasurer(fontFamily: string = TEXT_FONT_FAMILY): Measurer {
  let ctx: CanvasRenderingContext2D | null = null;
  try {
    if (typeof document !== 'undefined') {
      const canvas = document.createElement('canvas');
      ctx = canvas.getContext('2d');
    }
  } catch {
    ctx = null;
  }
  if (ctx == null) {
    return (text, fontPx) => text.length * fontPx * TEXT_AVG_GLYPH_FRACTION;
  }
  return (text, fontPx) => {
    ctx!.font = `${fontPx}px ${fontFamily}`;
    return ctx!.measureText(text).width;
  };
}

/**
 * Greedy word wrap with character-level splitting for single words wider
 * than the available width. Explicit newlines produce empty lines.
 */
function wrapText(text: string, maxWidth: number, fontPx: number, measure: Measurer): string[] {
  const lines: string[] = [];
  const paragraphs = text.split('\n');

  for (const para of paragraphs) {
    if (para === '') {
      lines.push('');
      continue;
    }

    const words = para.split(' ');
    let current = '';

    const flush = () => {
      if (current === '') return;
      if (measure(current, fontPx) <= maxWidth) {
        lines.push(current);
      } else {
        // A single word wider than the width: split by character
        let chunk = '';
        for (const ch of current) {
          if (chunk !== '' && measure(chunk + ch, fontPx) > maxWidth) {
            lines.push(chunk);
            chunk = ch;
          } else {
            chunk += ch;
          }
        }
        if (chunk !== '') lines.push(chunk);
      }
      current = '';
    };

    for (const word of words) {
      const candidate = current === '' ? word : `${current} ${word}`;
      if (measure(candidate, fontPx) <= maxWidth) {
        current = candidate;
      } else {
        flush();
        current = word;
      }
    }
    flush();
  }

  return lines;
}

/**
 * Measures a text object's box.
 *
 * - auto mode: width = min(longest line + padding, TEXT_MAX_AUTO_WIDTH_WORLD)
 *   with greedy word wrap beyond the cap;
 * - fixed mode: width = fixedWidth, text re-wrapped to it;
 * - height = lines × TEXT_SIZES[size] × TEXT_LINE_HEIGHT;
 * - empty text → 0 × 0 (the object is removed on edit end anyway).
 */
export function layoutText(
  text: string,
  size: TextSize,
  mode: 'auto' | 'fixed',
  fixedWidth: number | null,
  measure: Measurer,
): { width: number; height: number; lines: string[] } {
  const fontPx = TEXT_SIZES[size];

  if (text === '') {
    return { width: 0, height: 0, lines: [] };
  }

  const maxWidth =
    mode === 'fixed' && fixedWidth != null && Number.isFinite(fixedWidth)
      ? Math.max(1, fixedWidth)
      : TEXT_MAX_AUTO_WIDTH_WORLD;

  const lines = wrapText(text, maxWidth, fontPx, measure);

  let longest = 0;
  for (const line of lines) {
    longest = Math.max(longest, measure(line, fontPx));
  }

  const width =
    mode === 'fixed' && fixedWidth != null && Number.isFinite(fixedWidth)
      ? Math.max(1, fixedWidth)
      : Math.min(longest + TEXT_PADDING_WORLD, TEXT_MAX_AUTO_WIDTH_WORLD);

  const height = lines.length * fontPx * TEXT_LINE_HEIGHT;
  return { width, height, lines };
}
