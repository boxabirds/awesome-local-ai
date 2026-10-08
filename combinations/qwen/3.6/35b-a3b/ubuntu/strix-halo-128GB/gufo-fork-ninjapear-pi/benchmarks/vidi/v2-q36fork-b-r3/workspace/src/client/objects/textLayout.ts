import { TEXT_MAX_AUTO_WIDTH_WORLD, TEXT_SIZES, TEXT_LINE_HEIGHT } from '@shared/config';
import type { TextSize } from '@shared/config';

export type Measurer = (text: string, fontPx: number) => number; // width in world units

/**
 * Create a canvas-based measurer that uses measureText.
 * Falls back to an estimate if no canvas is available.
 */
export function createCanvasMeasurer(fontFamily = 'sans-serif'): Measurer {
  // Default fallback: average glyph width at each size
  const DEFAULT_AVG_GLYPH_WIDTH_PX: Record<TextSize, number> = {
    S: 8,
    M: 11,
    L: 18,
    XL: 32,
  };

  let measureFn: Measurer = (_text: string, fontPx: number): number => {
    // Estimate: ~5.5 characters per 60px at standard sizes
    const charCount = _text.length;
    return charCount * (fontPx / 5.5);
  };

  try {
    const canvas = typeof document !== 'undefined'
      ? document.createElement('canvas')
      : null;

    if (canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        measureFn = (text: string, fontPx: number): number => {
          ctx.font = `${fontPx}px ${fontFamily}`;
          return ctx.measureText(text).width;
        };
      }
    }
  } catch { /* ignore */ }

  return measureFn;
}

/**
 * Pure layout computation for text content.
 * 
 * Returns width, height and split lines.
 * Auto mode: width = min(longest line, MAX_AUTO_WIDTH), wrapping when > MAX_AUTO_WIDTH.
 * Fixed mode: width = fixedWidth (wraps at that width).
 * Height = number of rendered lines × size × TEXT_LINE_HEIGHT.
 */
export function layoutText(
  text: string,
  size: TextSize,
  mode: 'auto' | 'fixed',
  fixedWidth: number | null,
  measure: Measurer,
): { width: number; height: number; lines: string[] } {
  const fontPx = TEXT_SIZES[size];
  const lineHeight = fontPx * TEXT_LINE_HEIGHT;

  if (!text || text.length === 0) {
    return { width: 0, height: 0, lines: [''] };
  }

  // Split into explicit lines by newlines
  const rawLines = text.split('\n');

  // Process each line: word-wrap beyond max width
  const wrappedLines: string[] = [];

  for (const rawLine of rawLines) {
    if (rawLine.length === 0) {
      wrappedLines.push('');
      continue;
    }

    if (mode === 'fixed' && fixedWidth !== null) {
      // Wrap at fixed width using greedy word wrap
      const words = rawLine.split(/(\s+)/);
      let currentLine = '';
      for (const word of words) {
        const testLine = currentLine ? currentLine + word : word;
        if (currentLine === '' || measure(testLine, fontPx) <= fixedWidth) {
          currentLine = testLine;
        } else {
          wrappedLines.push(currentLine);
          currentLine = word;
        }
      }
      if (currentLine) wrappedLines.push(currentLine);
    } else {
      // Auto mode: only wrap if line exceeds MAX_AUTO_WIDTH
      const lineWidth = measure(rawLine, fontPx);
      if (lineWidth <= TEXT_MAX_AUTO_WIDTH_WORLD) {
        wrappedLines.push(rawLine);
      } else {
        // Greedy word wrap within max width
        const words = rawLine.split(/(\s+)/);
        let currentLine = '';
        for (const word of words) {
          const testLine = currentLine ? currentLine + word : word;
          if (measure(testLine, fontPx) <= TEXT_MAX_AUTO_WIDTH_WORLD) {
            currentLine = testLine;
          } else {
            if (currentLine) wrappedLines.push(currentLine);
            // Handle very long single words (no whitespace) — force break
            if (word.length > 0) {
              // Try character-by-character break for really long words
              let acc = '';
              for (let ci = 0; ci < word.length; ci++) {
                const testChar = acc + word[ci];
                if (measure(testChar, fontPx) <= TEXT_MAX_AUTO_WIDTH_WORLD) {
                  acc = testChar;
                } else {
                  if (acc) wrappedLines.push(acc);
                  acc = word[ci];
                }
              }
              if (acc) wrappedLines.push(acc);
            }
            currentLine = '';
          }
        }
        if (currentLine) wrappedLines.push(currentLine);
      }
    }
  }

  // Determine final width
  let maxWidth = 0;
  for (const line of wrappedLines) {
    const w = measure(line, fontPx);
    if (w > maxWidth) maxWidth = w;
  }

  if (mode === 'auto') {
    maxWidth = Math.min(maxWidth, TEXT_MAX_AUTO_WIDTH_WORLD);
  }

  if (mode === 'fixed' && fixedWidth !== null) {
    maxWidth = fixedWidth;
  }

  const height = wrappedLines.length * lineHeight;

  return {
    width: maxWidth,
    height,
    lines: wrappedLines,
  };
}
