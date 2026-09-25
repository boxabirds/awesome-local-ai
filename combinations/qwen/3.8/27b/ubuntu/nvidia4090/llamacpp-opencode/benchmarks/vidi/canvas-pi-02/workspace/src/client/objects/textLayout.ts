/**
 * Text layout (story 9): computes the box (width, height) and wrapped lines
 * for a text object from its content, size, and width mode.
 *
 * The same measurement is used by the layout and the rendered CSS, so the
 * stored box, the wrap, and the pixels agree.
 */

import {
  TEXT_ESTIMATED_GLYPH_RATIO,
  TEXT_FONT_FAMILY,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
  type TextSize,
} from '../../shared/config';

/** Measures the rendered width (world px) of a string at a given font size. */
export type Measurer = (text: string, fontPx: number) => number;

/**
 * Canvas-based measurer. The canvas font string must match the rendered CSS
 * exactly (same family, weight, size) so the stored box matches the pixels.
 */
export function createCanvasMeasurer(): Measurer {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d context unavailable');
  return (text: string, fontPx: number): number => {
    ctx.font = `${fontPx}px ${TEXT_FONT_FAMILY}`;
    return ctx.measureText(text).width;
  };
}

/**
 * Deterministic fallback measurer (used in tests and when canvas is
 * unavailable). Estimates width as `text.length × fontPx × ratio`.
 */
export function createFallbackMeasurer(): Measurer {
  return (text: string, fontPx: number): number => {
    return text.length * fontPx * TEXT_ESTIMATED_GLYPH_RATIO;
  };
}

/** Try canvas first, fall back to estimation. */
export function createMeasurer(): Measurer {
  try {
    return createCanvasMeasurer();
  } catch {
    return createFallbackMeasurer();
  }
}

// --- Wrapping ----------------------------------------------------------------

/**
 * Greedy word-wrap a single hard line at `maxWidth`. Words longer than the
 * limit break character-by-character (standard `overflow-wrap: break-word`).
 * Returns the wrapped segments (each ≤ maxWidth, except possibly the last
 * segment of a character-broken word).
 */
export function wrapLine(
  line: string,
  measurer: Measurer,
  fontPx: number,
  maxWidth: number,
): string[] {
  if (line.length === 0) return [''];

  const lineWidth = measurer(line, fontPx);
  if (lineWidth <= maxWidth) return [line];

  const words = line.split(' ').filter((w) => w.length > 0);
  if (words.length === 0) return ['']; // line is all spaces

  const result: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;

    if (measurer(candidate, fontPx) <= maxWidth) {
      current = candidate;
    } else {
      if (current) {
        result.push(current);
        current = '';
      }

      if (measurer(word, fontPx) <= maxWidth) {
        current = word;
      } else {
        // Break the word character by character.
        let charCurrent = '';
        for (const ch of word) {
          const charCandidate = charCurrent + ch;
          if (measurer(charCandidate, fontPx) <= maxWidth) {
            charCurrent = charCandidate;
          } else {
            if (charCurrent) result.push(charCurrent);
            charCurrent = ch;
          }
        }
        current = charCurrent;
      }
    }
  }

  if (current) result.push(current);
  if (result.length === 0) result.push('');

  return result;
}

// --- Layout -------------------------------------------------------------------

/** Options for layoutText. */
export interface LayoutOpts {
  measurer: Measurer;
  size: TextSize;
  widthMode: 'auto' | 'fixed';
  /** Current stored width (used in fixed mode). */
  width: number;
}

/** Result of layoutText. */
export interface TextLayout {
  /** Wrapped lines (hard line breaks preserved, soft wraps inserted). */
  lines: string[];
  /** Computed box width (world units). */
  width: number;
  /** Computed box height (world units). */
  height: number;
}

/**
 * Compute the box and wrapped lines for a text object.
 *
 * Auto mode: `width = min(longest hard line width, TEXT_MAX_AUTO_WIDTH_WORLD)`.
 * Fixed mode: `width = max(stored width, TEXT_MIN_WIDTH_WORLD)`.
 * Height: `line count × fontPx × TEXT_LINE_HEIGHT`.
 */
export function layoutText(text: string, opts: LayoutOpts): TextLayout {
  const fontPx = TEXT_SIZES[opts.size];
  const maxAutoWidth = TEXT_MAX_AUTO_WIDTH_WORLD;

  if (text.length === 0) {
    return { lines: [''], width: 0, height: 0 };
  }

  const hardLines = text.split('\n');

  const wrappedLines: string[] = [];
  for (const hardLine of hardLines) {
    if (opts.widthMode === 'auto') {
      wrappedLines.push(...wrapLine(hardLine, opts.measurer, fontPx, maxAutoWidth));
    } else {
      const fixedWidth = Math.max(opts.width, TEXT_MIN_WIDTH_WORLD);
      wrappedLines.push(...wrapLine(hardLine, opts.measurer, fontPx, fixedWidth));
    }
  }

  let width: number;
  if (opts.widthMode === 'auto') {
    // Width = min(longest hard line width, cap).
    let longest = 0;
    for (const hardLine of hardLines) {
      const w = opts.measurer(hardLine, fontPx);
      if (w > longest) longest = w;
    }
    width = Math.min(longest, maxAutoWidth);
  } else {
    width = Math.max(opts.width, TEXT_MIN_WIDTH_WORLD);
  }

  const height = wrappedLines.length * fontPx * TEXT_LINE_HEIGHT;

  return { lines: wrappedLines, width, height };
}
