import {
  DEFAULT_TEXT_SIZE,
  TEXT_FONT_FAMILY,
  TEXT_GLYPH_WIDTH_RATIO,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_PADDING_WORLD,
  TEXT_SIZES,
  type TextSize,
} from "../../shared/config";

/**
 * Text layout (`text.layout`, `text.wrap`, `text.height`, `text.measuring`).
 *
 * One pure function decides the box a piece of text needs, given a measurer:
 *
 *   - automatic width: the text widens up to `TEXT_MAX_AUTO_WIDTH_WORLD`, then
 *     wraps; the box is the longest line plus `TEXT_PADDING_WORLD` - never
 *     narrower than `TEXT_MIN_WIDTH_WORLD`, so empty text is still clickable -
 *     and never wider than the wrap capacity, so the browser never wraps a line
 *     this function just fitted;
 *   - fixed width: the stored width is the box, and the text wraps at it;
 *   - height: always the number of lines times `TEXT_LINE_HEIGHT` times the
 *     size's font size. It is never stored from a handle drag.
 *
 * The measurer is a parameter so the arithmetic can be unit-tested with a fake
 * one, and so measuring can fall back to a character estimate when there is no
 * canvas (TC-32). Rendering uses the same font family and the same line height
 * (`.text-object` in `src/client/styles.css`), which is what makes the stored
 * height match the height the browser lays out.
 */

/** Width of `text` rendered at `fontPx`, in board units. */
export type Measurer = (text: string, fontPx: number) => number;

export interface TextLayoutInput {
  readonly text: string;
  readonly size: TextSize;
  readonly widthMode: "auto" | "fixed";
  /** The stored width, used when `widthMode` is `fixed`. */
  readonly width?: number;
}

export interface TextLayout {
  readonly width: number;
  readonly height: number;
  /** Rendered line count. */
  readonly lines: number;
  /** True when at least one paragraph had to wrap. */
  readonly wrapped: boolean;
}

/** The font size a size preset stands for, defaulting when the key is unknown. */
export function fontSizeOf(size: unknown): number {
  return typeof size === "string" && Object.prototype.hasOwnProperty.call(TEXT_SIZES, size)
    ? TEXT_SIZES[size as TextSize]
    : TEXT_SIZES[DEFAULT_TEXT_SIZE];
}

/** The character-count estimate: the fallback, never a throw. */
export function estimateTextWidth(text: string, fontPx: number): number {
  const size = Number.isFinite(fontPx) && fontPx > 0 ? fontPx : TEXT_SIZES[DEFAULT_TEXT_SIZE];
  const characters = typeof text === "string" ? Array.from(text).length : 0;
  return characters * size * TEXT_GLYPH_WIDTH_RATIO;
}

/**
 * `layoutText(input, measure) -> { width, height, lines, wrapped }`
 *
 * Explicit line breaks always start a new line; only a paragraph that does not
 * fit wraps. An empty paragraph is still a line, so a text object always has a
 * height.
 */
export function layoutText(input: TextLayoutInput, measure: Measurer): TextLayout {
  const text = typeof input.text === "string" ? input.text : "";
  const fontPx = fontSizeOf(input.size);
  const fixed = input.widthMode === "fixed";
  const stored = input.width;
  const capacity = fixed
    ? Math.max(TEXT_MIN_WIDTH_WORLD, Number.isFinite(stored) && (stored as number) > 0 ? (stored as number) : TEXT_MIN_WIDTH_WORLD)
    : TEXT_MAX_AUTO_WIDTH_WORLD;

  const lines: string[] = [];
  let wrapped = false;
  for (const paragraph of text.split(/\r?\n/)) {
    const paragraphLines = wrapParagraph(paragraph, capacity, fontPx, measure);
    if (paragraphLines.length > 1) wrapped = true;
    lines.push(...paragraphLines);
  }

  let longest = 0;
  for (const line of lines) {
    const width = measure(line, fontPx);
    if (Number.isFinite(width) && width > longest) longest = width;
  }

  // A fixed box keeps the width it was given whether or not the text wrapped;
  // an automatic one is as wide as its longest line, and as wide as the wrap
  // capacity once the text had to wrap.
  const natural = wrapped ? capacity : Math.min(longest + TEXT_PADDING_WORLD, capacity);
  const width = Math.max(TEXT_MIN_WIDTH_WORLD, fixed ? capacity : natural);
  return {
    width,
    height: lines.length * fontPx * TEXT_LINE_HEIGHT,
    lines: lines.length,
    wrapped,
  };
}

// ---- internals ------------------------------------------------------------

/** Greedy word wrap. A word wider than `capacity` gets a line of its own. */
function wrapParagraph(
  paragraph: string,
  capacity: number,
  fontPx: number,
  measure: Measurer,
): string[] {
  if (paragraph.length === 0) return [""];
  if (measure(paragraph, fontPx) <= capacity) return [paragraph];

  const tokens = paragraph.split(/(\s+)/);
  const lines: string[] = [];
  let current = "";
  for (const token of tokens) {
    if (token.length === 0) continue;
    const whitespace = /^\s+$/.test(token);
    if (current.length === 0) {
      // The whitespace a line break just consumed does not start the next line.
      if (whitespace) continue;
      current = token;
      continue;
    }
    const candidate = current + token;
    if (whitespace || measure(candidate, fontPx) <= capacity) current = candidate;
    else {
      lines.push(current);
      current = token;
    }
  }
  lines.push(current);
  return lines;
}

// ---- measuring in the browser ---------------------------------------------

interface MeasureContext {
  font: string;
  measureText(text: string): { width: number };
}

function fontString(fontPx: number): string {
  const size = Number.isFinite(fontPx) && fontPx > 0 ? fontPx : TEXT_SIZES[DEFAULT_TEXT_SIZE];
  return `${size}px ${TEXT_FONT_FAMILY}`;
}

/** jsdom has no 2d canvas at all; asking it for one only makes noise. */
function hasCanvasSupport(): boolean {
  if (typeof OffscreenCanvas === "function") return true;
  if (typeof document === "undefined" || typeof document.createElement !== "function") return false;
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent ?? "";
  return !/jsdom/i.test(ua);
}

function measureContext(): MeasureContext | null {
  if (!hasCanvasSupport()) return null;
  try {
    if (typeof OffscreenCanvas === "function") {
      const context = new OffscreenCanvas(1, 1).getContext("2d") as MeasureContext | null;
      if (context) return context;
    }
    const canvas = document.createElement("canvas");
    return canvas.getContext("2d") as MeasureContext | null;
  } catch {
    return null;
  }
}

/**
 * `createCanvasMeasurer() -> Measurer`
 *
 * Real text metrics from a canvas, measured with the board's own font stack.
 * With no canvas - or with a measurement that is not a usable number - it
 * returns the character-count estimate instead of throwing, which is what keeps
 * layout total (TC-32).
 */
export function createCanvasMeasurer(): Measurer {
  const context = measureContext();
  if (!context) return estimateTextWidth;

  return (text, fontPx) => {
    try {
      context.font = fontString(fontPx);
      const width = context.measureText(text).width;
      if (!Number.isFinite(width) || width <= 0) return estimateTextWidth(text, fontPx);
      return width;
    } catch {
      return estimateTextWidth(text, fontPx);
    }
  };
}

let sharedMeasurer: Measurer | undefined;

/** The measurer every text object on this client shares. */
export function defaultMeasurer(): Measurer {
  if (!sharedMeasurer) sharedMeasurer = createCanvasMeasurer();
  return sharedMeasurer;
}
