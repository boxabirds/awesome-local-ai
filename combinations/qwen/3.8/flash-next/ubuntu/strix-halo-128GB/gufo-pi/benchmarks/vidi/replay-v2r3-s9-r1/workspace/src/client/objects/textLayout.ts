/**
 * Text layout (story 9). Pure functions plus a canvas measurer: given the
 * text, a size preset and the width mode, produce the box (and the wrapped
 * lines) that a text object stores and renders.
 *
 * Layout is deterministic and free of React so it can be unit tested with a
 * fake measurer, and so every client can agree on a stored box.
 */
import {
  TEXT_FONT_FAMILY,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
} from '../../shared/config';
import type { TextSize } from '../../shared/config';

/** Measures `text` at `fontPx` and returns its width in world units. */
export type Measurer = (text: string, fontPx: number) => number;

/**
 * Slack added to the longest measured line in auto mode so the rendered box is
 * a little wider than the words (browsers round text metrics differently).
 */
export const TEXT_BOX_PADDING_WORLD = 8;

/** Average glyph width, as a fraction of the font size, used without a canvas. */
export const TEXT_GLYPH_WIDTH_RATIO = 0.52;

/** Character-count estimate of a line's width (the measurer's fallback). */
export function estimateTextWidth(text: string, fontPx: number): number {
  return text.length * fontPx * TEXT_GLYPH_WIDTH_RATIO;
}

type Ctx = { font: string; measureText(text: string): { width: number } };

/**
 * Builds a measurer backed by a 2d canvas context. When no canvas is available
 * (server, jsdom, blocked API) it falls back to the character-count estimate
 * instead of throwing, so layout always produces a box.
 */
export function createCanvasMeasurer(fontFamily: string = TEXT_FONT_FAMILY): Measurer {
  let ctx: Ctx | null | undefined;

  const obtain = (): Ctx | null => {
    if (ctx !== undefined) return ctx;
    ctx = null;
    try {
      if (typeof OffscreenCanvas !== 'undefined') {
        const canvas = new OffscreenCanvas(1, 1);
        const c = canvas.getContext('2d') as Ctx | null;
        if (c) ctx = c;
      }
    } catch {
      ctx = null;
    }
    if (ctx === null) {
      try {
        if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
          const canvas = document.createElement('canvas') as HTMLCanvasElement;
          const c = (canvas.getContext?.('2d') as Ctx | null) ?? null;
          if (c) ctx = c;
        }
      } catch {
        ctx = null;
      }
    }
    return ctx;
  };

  return (text: string, fontPx: number): number => {
    const c = obtain();
    if (c) {
      try {
        c.font = `${fontPx}px ${fontFamily}`;
        const width = c.measureText(text).width;
        if (Number.isFinite(width)) return width;
      } catch {
        /* fall through to the estimate */
      }
    }
    return estimateTextWidth(text, fontPx);
  };
}

/** The single measurer used by the board UI. */
let sharedMeasurer: Measurer | null = null;

/** The board's shared measurer (created once, canvas-backed when possible). */
export function getSharedMeasurer(): Measurer {
  if (!sharedMeasurer) sharedMeasurer = createCanvasMeasurer();
  return sharedMeasurer;
}

/**
 * Word wrap of one logical line to `maxWidth`.
 *
 * Returns the wrapped lines plus the number of *visual* lines they occupy: a
 * single word wider than the content width is broken by the browser
 * (`overflow-wrap: break-word`) over several lines, and the box has to be tall
 * enough for them.
 */
function wrapLine(
  line: string,
  maxWidth: number,
  fontPx: number,
  measure: Measurer,
): { lines: string[]; visualLines: number } {
  const available = Math.max(1, maxWidth);
  if (line === '') return { lines: [''], visualLines: 1 };

  const lines: string[] = [];
  let visualLines = 0;
  let current = '';
  let currentWidth = 0;

  const flush = (): void => {
    lines.push(current);
    visualLines += Math.max(1, Math.ceil(currentWidth / available));
    current = '';
    currentWidth = 0;
  };

  for (const word of line.split(' ')) {
    const candidate = current === '' ? word : `${current} ${word}`;
    const candidateWidth = measure(candidate, fontPx);
    if (current !== '' && candidateWidth > available) {
      flush();
      current = word;
      currentWidth = measure(word, fontPx);
    } else {
      current = candidate;
      currentWidth = candidateWidth;
    }
  }
  flush();

  return { lines, visualLines };
}

export interface TextLayout {
  /** Box width in world units (border box, padding included). */
  width: number;
  /** Box height in world units: always the height of the content. */
  height: number;
  /** The lines the content is drawn as (explicit newlines and wrapping). */
  lines: string[];
}

/**
 * Computes the box of a text object.
 *
 * The rendered element is a border box with TEXT_BOX_PADDING_WORLD on both
 * sides, so the text itself gets `width - 2 * padding` of room:
 *
 * - auto: as wide as its longest line plus that padding, never wider than
 *   TEXT_MAX_AUTO_WIDTH_WORLD; lines wider than the content area wrap greedily.
 * - fixed: exactly `fixedWidth` (never below TEXT_MIN_WIDTH_WORLD); every
 *   logical line wraps inside it.
 *
 * Height is the number of visual lines times font size times TEXT_LINE_HEIGHT,
 * so height always follows the content and never needs a vertical handle.
 */
export function layoutText(
  text: string,
  size: TextSize,
  mode: 'auto' | 'fixed',
  fixedWidth: number | null,
  measure: Measurer,
): TextLayout {
  const fontPx = TEXT_SIZES[size] ?? TEXT_SIZES.M;
  const logicalLines = (text ?? '').split('\n');
  const contentPadding = 2 * TEXT_BOX_PADDING_WORLD;

  const requested =
    typeof fixedWidth === 'number' && Number.isFinite(fixedWidth)
      ? fixedWidth
      : TEXT_MIN_WIDTH_WORLD;
  const fixedBox = Math.max(TEXT_MIN_WIDTH_WORLD, requested);
  const maxContent = TEXT_MAX_AUTO_WIDTH_WORLD - contentPadding;

  let width: number;
  let wrapAt: number;
  if (mode === 'fixed') {
    width = fixedBox;
    wrapAt = fixedBox - contentPadding;
  } else {
    // Auto: the box hugs the longest logical line until that no longer fits the
    // widest box allowed. From there the box is exactly the maximum, so the
    // width the text wraps at and the box that is stored always agree — a box
    // that shrink-wrapped the *wrapped* lines would be narrower than the width
    // they wrapped at, and the browser would then need more lines than stored.
    let widest = 0;
    for (const line of logicalLines) {
      const w = measure(line, fontPx);
      if (w > widest) widest = w;
    }
    if (widest <= maxContent) {
      const height = logicalLines.length * fontPx * TEXT_LINE_HEIGHT;
      return {
        width: Math.min(Math.max(widest + contentPadding, TEXT_MIN_WIDTH_WORLD), TEXT_MAX_AUTO_WIDTH_WORLD),
        height,
        lines: logicalLines,
      };
    }
    width = TEXT_MAX_AUTO_WIDTH_WORLD;
    wrapAt = maxContent;
  }

  const lines: string[] = [];
  let visualLines = 0;
  for (const line of logicalLines) {
    const wrapped = wrapLine(line, wrapAt, fontPx, measure);
    for (const l of wrapped.lines) lines.push(l);
    visualLines += wrapped.visualLines;
  }

  const height = visualLines * fontPx * TEXT_LINE_HEIGHT;
  return { width, height, lines };
}
