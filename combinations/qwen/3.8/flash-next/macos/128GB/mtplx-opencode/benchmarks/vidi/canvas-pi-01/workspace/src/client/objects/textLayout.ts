/**
 * Story 9 · task 4 — the text layout maths (design "Text layout and box sync").
 *
 * Two pure pieces, both testable without a DOM:
 *
 *  - {@link createCanvasMeasurer}: measure a run of text in world units using a
 *    real 2D canvas, falling back to a character-count estimate when no canvas
 *    exists (jsdom, headless). The estimate is what makes the layout unit tests
 *    deterministic and what keeps the board from throwing in an environment with
 *    no `measureText`.
 *  - {@link layoutText}: given text, a size preset and a width mode, decide the
 *    stored box and the wrapped lines. Auto width grows to the longest line but
 *    never past `TEXT_MAX_AUTO_WIDTH_WORLD`, then greedy-wraps; fixed width
 *    wraps at the given width; height always follows the content (the box height
 *    is *derived*, never dragged).
 *
 * All lengths are in **world units** (the same space the board is drawn and the
 * camera transforms in); the measurer is handed world units and returns world
 * units, so this module knows nothing about zoom or pixels.
 */
import {
  TEXT_GLYPH_WIDTH_RATIO,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_SIZES,
  type TextSize,
} from '../../shared/config';

/** Measure the width of `text` at `fontPx`, in world units. */
export type Measurer = (text: string, fontPx: number) => number;

/** The smallest box edge we will ever store, so a box is never zero-sized. */
const MIN_BOX = 1;

/**
 * A measurer backed by an `OffscreenCanvas` / `<canvas>` 2D context. When no
 * canvas is reachable it estimates with `TEXT_GLYPH_WIDTH_RATIO` (a named
 * average glyph width) so the layout never throws and the pure tests stay
 * deterministic.
 */
export function createCanvasMeasurer(fontFamily = 'sans-serif'): Measurer {
  let context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null;
  let probed = false;

  const ensureContext = (): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null => {
    if (probed) return context;
    probed = true;
    try {
      if (typeof OffscreenCanvas !== 'undefined') {
        const canvas = new OffscreenCanvas(1, 1);
        context = canvas.getContext('2d') ?? null;
      } else if (typeof document !== 'undefined' && document.createElement) {
        const canvas = document.createElement('canvas');
        context = canvas.getContext('2d') ?? null;
      }
    } catch {
      context = null;
    }
    if (context) {
      try {
        context.font = `12px ${fontFamily}`;
      } catch {
        // A context that rejects a font string still measures at the default.
      }
    }
    return context;
  };

  return (text, fontPx) => {
    if (text.length === 0) return 0;
    const ctx = ensureContext();
    if (ctx) {
      try {
        ctx.font = `${fontPx}px ${fontFamily}`;
        const width = ctx.measureText(text).width;
        if (Number.isFinite(width)) return width;
      } catch {
        // Fall through to the estimate.
      }
    }
    // Fallback estimate: a constant glyph-width ratio of the font size.
    return text.length * fontPx * TEXT_GLYPH_WIDTH_RATIO;
  };
}

/** The estimate measurer, exposed for tests that want the fallback explicitly. */
export const estimateMeasurer: Measurer = (text, fontPx) =>
  text.length * fontPx * TEXT_GLYPH_WIDTH_RATIO;

/** Greedy word wrap: pack words onto a line until the next would exceed `max`. */
function wrapLine(line: string, max: number, fontPx: number, measure: Measurer): string[] {
  if (max <= 0) return [line];
  if (measure(line, fontPx) <= max) return [line];

  const words = line.split(' ');
  // A single over-long word (no spaces) cannot be wrapped further; keep it whole.
  if (words.length <= 1) return [line];

  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if (current === '') {
      current = word;
      continue;
    }
    const candidate = `${current} ${word}`;
    if (measure(candidate, fontPx) <= max) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current !== '') lines.push(current);
  return lines.length > 0 ? lines : [line];
}

/**
 * Compute the box and wrapped lines for one text object.
 *
 * - Auto width: the box grows to the widest *rendered* line, capped at
 *   `TEXT_MAX_AUTO_WIDTH_WORLD`; anything wider wraps (greedy) within that cap.
 * - Fixed width: the box is exactly `fixedWidth` and text wraps at it.
 * - Height always equals `lines × TEXT_SIZES[size] × TEXT_LINE_HEIGHT`, so it
 *   follows the content in both modes (a handle drag changes width; height
 *   follows — height is never dragged directly).
 */
export function layoutText(
  text: string,
  size: TextSize,
  mode: 'auto' | 'fixed',
  fixedWidth: number | null,
  measure: Measurer,
): { width: number; height: number; lines: string[] } {
  const fontPx = TEXT_SIZES[size];
  const inputLines = text.split('\n');

  // Width is decided from the longest *raw* line before wrapping. Auto width
  // grows to it but never past the cap; when a line exceeds the cap the box
  // stays at the cap and the line wraps inside it (design: width =
  // min(longest line, TEXT_MAX_AUTO_WIDTH_WORLD)).
  let longest = MIN_BOX;
  for (const raw of inputLines) {
    const measured = measure(raw, fontPx);
    if (measured > longest) longest = measured;
  }
  const wrapWidth =
    mode === 'fixed' && fixedWidth !== null
      ? fixedWidth
      : Math.min(Math.max(longest, MIN_BOX), TEXT_MAX_AUTO_WIDTH_WORLD);

  // Wrap each explicit line independently; newlines always break.
  const lines: string[] = [];
  for (const raw of inputLines) {
    if (raw.length === 0) {
      lines.push('');
      continue;
    }
    lines.push(...wrapLine(raw, wrapWidth, fontPx, measure));
  }

  const width =
    mode === 'fixed' && fixedWidth !== null
      ? fixedWidth
      : Math.min(Math.max(longest, MIN_BOX), TEXT_MAX_AUTO_WIDTH_WORLD);

  const height = lines.length * fontPx * TEXT_LINE_HEIGHT;
  return {
    width: Math.round(width * 1000) / 1000,
    height: Math.round(height * 1000) / 1000,
    lines,
  };
}