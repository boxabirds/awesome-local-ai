import { TextSize, TEXT_SIZES, TEXT_MAX_AUTO_WIDTH_WORLD, TEXT_LINE_HEIGHT, TEXT_FONT_FAMILY } from '@shared/config';

/** Measure text width in world units for a given font size in px. */
export type Measurer = (text: string, fontPx: number) => number;

/** Average glyph width ratio for fallback estimation when canvas is unavailable. */
const FALLBACK_GLYPH_RATIO = 0.6;

/**
 * Creates a canvas-based text measurer. Falls back to a character-count
 * estimate if canvas is unavailable (e.g. in jsdom).
 */
export function createCanvasMeasurer(fontFamily: string = TEXT_FONT_FAMILY): Measurer {
  // Try to get a canvas context
  let ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null;
  try {
    if (typeof OffscreenCanvas !== 'undefined') {
      const c = new OffscreenCanvas(1, 1);
      ctx = c.getContext('2d');
    } else if (typeof document !== 'undefined') {
      const c = document.createElement('canvas');
      ctx = c.getContext('2d');
    }
  } catch {
    // Canvas not available
  }

  return (text: string, fontPx: number): number => {
    if (!ctx) {
      // Estimate: average glyph width × character count
      return text.length * fontPx * FALLBACK_GLYPH_RATIO;
    }
    ctx.font = `${fontPx}px ${fontFamily}`;
    const metrics = ctx.measureText(text);
    return metrics.width;
  };
}

/**
 * Compute the layout for a text object.
 * - auto mode: width = min(longest line, TEXT_MAX_AUTO_WIDTH_WORLD), lines wrapped greedily
 * - fixed mode: width = fixedWidth, lines wrapped at fixedWidth
 * - height = number of lines × font size × TEXT_LINE_HEIGHT
 */
export function layoutText(
  text: string,
  size: TextSize,
  mode: 'auto' | 'fixed',
  fixedWidth: number | null,
  measure: Measurer,
): { width: number; height: number; lines: string[] } {
  const fontPx = TEXT_SIZES[size];
  const rawLines = text.split('\n');

  let targetWidth: number;
  if (mode === 'fixed' && fixedWidth !== null) {
    targetWidth = fixedWidth;
  } else {
    // Auto mode: width = min(longest raw line, TEXT_MAX_AUTO_WIDTH_WORLD)
    let maxLineWidth = 0;
    for (const line of rawLines) {
      const w = measure(line, fontPx);
      if (w > maxLineWidth) maxLineWidth = w;
    }
    targetWidth = Math.min(maxLineWidth, TEXT_MAX_AUTO_WIDTH_WORLD);
  }

  // Wrap lines that exceed targetWidth
  const lines: string[] = [];
  for (const rawLine of rawLines) {
    if (rawLine === '') {
      lines.push('');
      continue;
    }
    const lineW = measure(rawLine, fontPx);
    if (lineW <= targetWidth) {
      lines.push(rawLine);
    } else {
      // Greedy word wrap
      const words = rawLine.split(' ');
      let currentLine = '';
      for (const word of words) {
        const candidate = currentLine === '' ? word : currentLine + ' ' + word;
        const candidateW = measure(candidate, fontPx);
        if (candidateW > targetWidth && currentLine !== '') {
          lines.push(currentLine);
          currentLine = word;
        } else {
          currentLine = candidate;
        }
      }
      if (currentLine !== '') {
        lines.push(currentLine);
      }
    }
  }

  const height = Math.ceil(lines.length * fontPx * TEXT_LINE_HEIGHT);

  return { width: targetWidth, height, lines };
}
