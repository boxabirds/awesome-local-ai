/**
 * Measuring a text object's box (story 9).
 *
 * `layoutText` is pure: characters, size preset, width mode and a measurer in, a box and the
 * wrapped lines out. Everything about it is deterministic, which is why it is unit-tested with a
 * fake measurer while the real measurement - which depends on the font the browser actually has -
 * is proven in the browser suite.
 *
 * The box is stored on the object rather than derived at render time, so only the client that
 * made a change measures it (see `useTextBoxSync`).
 */
import {
  TEXT_BOX_PADDING_WORLD,
  TEXT_ESTIMATE_GLYPH_RATIO,
  TEXT_FONT_FAMILY,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
  type TextSize,
} from '../../shared/config';

/** The width in world units of `text` drawn at `fontPx` world units. */
export type Measurer = (text: string, fontPx: number) => number;

/** The box a text object needs in order to show `text`. */
export interface TextBox {
  width: number;
  height: number;
  /** The lines the text is drawn on, after wrapping (explicit newlines are kept). */
  lines: string[];
}

/** The usable width inside a box of `width` world units. */
function contentWidth(width: number): number {
  return width - TEXT_BOX_PADDING_WORLD;
}

/**
 * The height of `lines` lines of `size`, in world units (PRD text.height: the height always
 * follows the content).
 */
function linesHeight(size: TextSize, lines: number): number {
  return Math.max(1, lines) * TEXT_SIZES[size] * TEXT_LINE_HEIGHT;
}

/** The width the estimate charges per character, for a given font size. */
export function estimateTextWidth(text: string, fontPx: number): number {
  return text.length * fontPx * TEXT_ESTIMATE_GLYPH_RATIO;
}

interface MeasureContext {
  font: string;
  measureText(text: string): { width: number };
}

type CanvasLike = { getContext(id: '2d'): MeasureContext | null };

/**
 * A 2D drawing context to measure with, or null where there is none (node, jsdom, a browser with
 * canvas blocked). `null` is remembered, so a board without a canvas does not retry per keystroke.
 */
function createMeasureContext(): MeasureContext | null {
  const host = globalThis as {
    OffscreenCanvas?: new (width: number, height: number) => CanvasLike;
    document?: { createElement(tagName: string): unknown };
  };
  try {
    if (typeof host.OffscreenCanvas === 'function') {
      const context = new host.OffscreenCanvas(1, 1).getContext('2d');
      if (context) return context;
    }
    const element = host.document?.createElement('canvas') as CanvasLike | undefined;
    return element?.getContext?.('2d') ?? null;
  } catch {
    return null;
  }
}

/**
 * Measures text the way the browser draws it, in the board's standard font.
 *
 * Where there is no canvas at all, it falls back to counting characters at an average glyph width
 * (TC-32): a text object measured that way is a little wide or a little narrow, but the board
 * neither throws nor stalls.
 */
export function createCanvasMeasurer(fontFamily: string = TEXT_FONT_FAMILY): Measurer {
  let context: MeasureContext | null | undefined;
  const contextOf = (): MeasureContext | null => {
    if (context === undefined) context = createMeasureContext();
    return context;
  };

  return (text: string, fontPx: number): number => {
    const ctx = contextOf();
    if (!ctx) return estimateTextWidth(text, fontPx);
    try {
      ctx.font = `${fontPx}px ${fontFamily}`;
      const width = ctx.measureText(text).width;
      return Number.isFinite(width) ? width : estimateTextWidth(text, fontPx);
    } catch {
      return estimateTextWidth(text, fontPx);
    }
  };
}

/**
 * Breaks one line into lines at most `limit` wide, breaking between words.
 *
 * A single word wider than the limit is left whole on its own line: the box never rewrites what
 * the person typed, and a word that sticks out is visible rather than silently cut.
 */
function wrapLine(line: string, limit: number, fontPx: number, measure: Measurer): string[] {
  if (limit <= 0 || measure(line, fontPx) <= limit) return [line];

  const wrapped: string[] = [];
  let current = '';
  for (const word of line.split(' ')) {
    if (current === '') {
      current = word;
      continue;
    }
    const candidate = `${current} ${word}`;
    if (measure(candidate, fontPx) <= limit) current = candidate;
    else {
      wrapped.push(current);
      current = word;
    }
  }
  wrapped.push(current);
  return wrapped;
}

/**
 * The box for `text`.
 *
 * - **auto** (PRD text.auto_width): as wide as the longest line plus a little headroom, up to
 *   `TEXT_MAX_AUTO_WIDTH_WORLD`. A line past the maximum wraps, and the box then sits at the
 *   maximum: the text never stretches across the board.
 * - **fixed** (PRD text.fixed_width): exactly the width the person dragged it to, never below
 *   `TEXT_MIN_WIDTH_WORLD`, with the text rewrapped inside it.
 *
 * Height is always the number of lines, whatever the mode.
 */
export function layoutText(
  text: string,
  size: TextSize,
  mode: 'auto' | 'fixed',
  fixedWidth: number | null,
  measure: Measurer,
): TextBox {
  const fontPx = TEXT_SIZES[size];
  const source = text.split('\n');

  if (mode === 'fixed') {
    const width = Math.max(TEXT_MIN_WIDTH_WORLD, fixedWidth ?? TEXT_MIN_WIDTH_WORLD);
    const limit = contentWidth(width);
    const lines = source.flatMap((line) => wrapLine(line, limit, fontPx, measure));
    return { width, height: linesHeight(size, lines.length), lines };
  }

  let widest = 0;
  for (const line of source) widest = Math.max(widest, measure(line, fontPx));

  if (widest > TEXT_MAX_AUTO_WIDTH_WORLD) {
    const lines = source.flatMap((line) =>
      wrapLine(line, contentWidth(TEXT_MAX_AUTO_WIDTH_WORLD), fontPx, measure),
    );
    return { width: TEXT_MAX_AUTO_WIDTH_WORLD, height: linesHeight(size, lines.length), lines };
  }

  const width = Math.max(
    TEXT_MIN_WIDTH_WORLD,
    Math.min(widest + TEXT_BOX_PADDING_WORLD, TEXT_MAX_AUTO_WIDTH_WORLD),
  );
  return { width, height: linesHeight(size, source.length), lines: source };
}
