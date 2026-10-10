import {
  TEXT_FONT_FAMILY,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
  type TextSize
} from '../../shared/config';

// Width in world units of `text` rendered at `fontPx`.
export type Measurer = (text: string, fontPx: number) => number;

// Average glyph width as a fraction of the font size, used when no canvas is
// available (TC-32). Never exact, always monotone in length and font size.
const TEXT_GLYPH_WIDTH_RATIO = 0.5;

function estimate(text: string, fontPx: number): number {
  return text.length * fontPx * TEXT_GLYPH_WIDTH_RATIO;
}

function canvasContext(fontFamily: string): CanvasRenderingContext2D | null {
  if (typeof document === 'undefined') return null;
  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (ctx === null) return null;
    ctx.font = `12px ${fontFamily}`;
    return ctx;
  } catch {
    return null;
  }
}

export function createCanvasMeasurer(fontFamily: string = TEXT_FONT_FAMILY): Measurer {
  const ctx = canvasContext(fontFamily);
  if (ctx === null) return estimate;
  return (text, fontPx) => {
    ctx.font = `${fontPx}px ${fontFamily}`;
    return ctx.measureText(text).width;
  };
}

// Greedy word wrap of one physical line into lines at most `maxWidth` wide.
// A single word wider than maxWidth keeps its own (overflowing) line, which
// the caller then caps to maxWidth for display.
function wrapLine(
  line: string,
  maxWidth: number,
  fontPx: number,
  measure: Measurer
): string[] {
  if (line.length === 0) return [''];
  const words = line.split(' ');
  const out: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current.length === 0 ? word : `${current} ${word}`;
    if (current.length === 0 || measure(candidate, fontPx) <= maxWidth) {
      current = candidate;
    } else {
      out.push(current);
      current = word;
    }
  }
  out.push(current);
  return out;
}

// Pure layout maths. No padding: the stored box is exactly the measured text
// block (see NOTES.md). Explicit newlines are always respected.
export function layoutText(
  text: string,
  size: TextSize,
  mode: 'auto' | 'fixed',
  fixedWidth: number | null,
  measure: Measurer
): { width: number; height: number; lines: string[] } {
  const fontPx = TEXT_SIZES[size];
  const segments = text.split('\n');
  let lines: string[];
  let width: number;
  if (mode === 'fixed') {
    width = Math.max(fixedWidth ?? TEXT_MIN_WIDTH_WORLD, TEXT_MIN_WIDTH_WORLD);
    lines = segments.flatMap((s) => wrapLine(s, width, fontPx, measure));
  } else {
    // Width caps the longest physical line at the auto maximum; content
    // wider than that is greedy-wrapped to fit (TC-08, TC-09).
    let widest = 0;
    for (const segment of segments) widest = Math.max(widest, measure(segment, fontPx));
    lines = segments.flatMap((s) =>
      wrapLine(s, TEXT_MAX_AUTO_WIDTH_WORLD, fontPx, measure)
    );
    width = Math.min(widest, TEXT_MAX_AUTO_WIDTH_WORLD);
  }
  return {
    width,
    height: lines.length * fontPx * TEXT_LINE_HEIGHT,
    lines
  };
}
