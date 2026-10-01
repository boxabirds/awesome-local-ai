// src/client/objects/textLayout.ts
// Pure text layout: measures text width and computes line wrapping.

import {
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_SIZES,
  TEXT_LINE_HEIGHT,
  TEXT_FONT_FAMILY,
  type TextSize,
} from '../../shared/config';

/**
 * A function that measures the width of a text string at a given font size.
 * Returns width in world units.
 */
export type Measurer = (text: string, fontPx: number) => number;

/**
 * Average glyph width as a ratio of font size.
 * Used as a fallback estimate when canvas is not available.
 */
const AVERAGE_GLYPH_WIDTH_RATIO = 0.6;

/**
 * Creates a canvas-based text measurer.
 * Falls back to a character-count estimate if canvas is not available.
 */
export function createCanvasMeasurer(fontFamily: string = TEXT_FONT_FAMILY): Measurer {
  // Try to create a canvas context
  let ctx: CanvasRenderingContext2D | null = null;

  try {
    if (typeof document !== 'undefined') {
      const canvas = document.createElement('canvas');
      ctx = canvas.getContext('2d');
    }
  } catch {
    ctx = null;
  }

  if (!ctx) {
    // Fallback: estimate based on character count
    return (text: string, fontPx: number) => {
      const visible = text.replace(/\n/g, '');
      return visible.length * fontPx * AVERAGE_GLYPH_WIDTH_RATIO;
    };
  }

  return (text: string, fontPx: number) => {
    ctx!.font = `${fontPx}px ${fontFamily}`;
    return ctx!.measureText(text).width;
  };
}

/**
 * Greedy word-wrap: splits text into lines that fit within maxLineWidth.
 * Respects explicit newlines. Words longer than maxLineWidth get their own line.
 */
function greedyWordWrap(text: string, maxLineWidth: number, measure: Measurer, fontPx: number): string[] {
  const lines: string[] = [];
  const paragraphs = text.split('\n');

  for (const paragraph of paragraphs) {
    if (paragraph === '') {
      lines.push('');
      continue;
    }

    // Measure the whole paragraph
    const paraWidth = measure(paragraph, fontPx);
    if (paraWidth <= maxLineWidth) {
      lines.push(paragraph);
      continue;
    }

    // Need to wrap: greedy word wrap
    const words = paragraph.split(' ');
    let currentLine = '';

    for (const word of words) {
      // Hard-break words that are longer than maxLineWidth
      const wordWidth = measure(word, fontPx);
      if (wordWidth > maxLineWidth) {
        // Flush current line first
        if (currentLine !== '') {
          lines.push(currentLine);
          currentLine = '';
        }
        // Hard-break the word character by character
        let chunk = '';
        for (let i = 0; i < word.length; i++) {
          const testChunk = chunk + word[i];
          if (measure(testChunk, fontPx) > maxLineWidth && chunk !== '') {
            lines.push(chunk);
            chunk = word[i];
          } else {
            chunk = testChunk;
          }
        }
        if (chunk !== '') {
          lines.push(chunk);
        }
        continue;
      }

      const candidate = currentLine === '' ? word : currentLine + ' ' + word;
      const candidateWidth = measure(candidate, fontPx);

      if (candidateWidth <= maxLineWidth) {
        currentLine = candidate;
      } else {
        if (currentLine !== '') {
          lines.push(currentLine);
        }
        currentLine = word;
      }
    }

    if (currentLine !== '') {
      lines.push(currentLine);
    }
  }

  return lines;
}

/**
 * Computes the layout (width, height, lines) for a text object.
 *
 * - auto mode: width = min(longest line width, TEXT_MAX_AUTO_WIDTH_WORLD),
 *   with greedy word-wrap for lines exceeding the max.
 * - fixed mode: width = fixedWidth, with greedy word-wrap at that width.
 * - height = lines × TEXT_SIZES[size] × TEXT_LINE_HEIGHT.
 */
export function layoutText(
  text: string,
  size: TextSize,
  mode: 'auto' | 'fixed',
  fixedWidth: number | null,
  measure: Measurer,
): { width: number; height: number; lines: string[] } {
  const fontPx = TEXT_SIZES[size];

  if (mode === 'fixed' && fixedWidth !== null) {
    // Fixed width: wrap at the fixed width
    const lines = greedyWordWrap(text, fixedWidth, measure, fontPx);
    const height = lines.length * fontPx * TEXT_LINE_HEIGHT;
    return { width: fixedWidth, height, lines };
  }

  // Auto mode: width is the longest line, capped at TEXT_MAX_AUTO_WIDTH_WORLD
  // First, split on explicit newlines
  const paragraphs = text.split('\n');

  // For each paragraph, check if it fits within max width
  // If not, wrap it
  const allLines: string[] = [];
  let maxLineWidth = 0;

  for (const para of paragraphs) {
    if (para === '') {
      allLines.push('');
      continue;
    }

    const paraWidth = measure(para, fontPx);
    if (paraWidth <= TEXT_MAX_AUTO_WIDTH_WORLD) {
      allLines.push(para);
      maxLineWidth = Math.max(maxLineWidth, paraWidth);
    } else {
      // Wrap this paragraph
      const wrapped = greedyWordWrap(para, TEXT_MAX_AUTO_WIDTH_WORLD, measure, fontPx);
      for (const line of wrapped) {
        allLines.push(line);
        const lineW = measure(line, fontPx);
        maxLineWidth = Math.max(maxLineWidth, lineW);
      }
    }
  }

  // Cap width at max
  const width = Math.min(maxLineWidth, TEXT_MAX_AUTO_WIDTH_WORLD);
  const height = allLines.length * fontPx * TEXT_LINE_HEIGHT;

  return { width, height, lines: allLines };
}
