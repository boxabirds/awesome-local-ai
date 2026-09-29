/**
 * Story 9: pure text layout (text.layout).
 *
 * `layoutText` computes a text object's box from its content: auto mode takes
 * the longest line up to TEXT_MAX_AUTO_WIDTH_WORLD (greedy word wrap beyond
 * it), fixed mode wraps at the pinned width; height always equals
 * lines × preset × TEXT_LINE_HEIGHT (text.height).
 *
 * Measurement is injected (`Measurer`): the app uses `createCanvasMeasurer`
 * (canvas measureText in the preset's world-unit font, falling back to a
 * character-count estimate when no canvas exists — unit/jsdom), tests use a
 * deterministic fake. Nothing here touches the DOM, the doc or React.
 */
import {
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_SIZES,
  TEXT_LINE_HEIGHT,
  TEXT_AVG_GLYPH_WIDTH_RATIO,
  type TextSize,
} from 'src/shared/config';
import type { TextWidthMode } from 'src/shared/objects/text';

/** Width of `text` rendered at `fontPx` (board/world units). */
export type Measurer = (text: string, fontPx: number) => number;

/**
 * Greedy word wrap of `line` so each wrapped line measures ≤ `limit`.
 * Words are space-separated; a single word longer than `limit` is broken
 * character-wise so the result always fits (a text box never exceeds its
 * mode's width, text.auto_width / text.fixed_width).
 */
function wrapLine(line: string, limit: number, measure: Measurer, fontPx: number): string[] {
  if (line === '') return [''];
  if (measure(line, fontPx) <= limit) return [line];

  const words = line.split(' ');
  const out: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current === '' ? word : `${current} ${word}`;
    if (measure(candidate, fontPx) <= limit) {
      current = candidate;
      continue;
    }
    if (current !== '') {
      out.push(current);
      current = '';
    }
    // The word alone exceeds the limit: break it character-wise.
    if (measure(word, fontPx) <= limit) {
      current = word;
      continue;
    }
    let piece = '';
    for (const ch of word) {
      if (measure(piece + ch, fontPx) <= limit) {
        piece += ch;
      } else {
        out.push(piece);
        piece = ch;
      }
    }
    current = piece;
  }
  out.push(current);
  return out;
}

/**
 * Lays out `text` at size `size`:
 * - auto mode: width = min(longest line, TEXT_MAX_AUTO_WIDTH_WORLD), lines
 *   longer than the cap are greedy-word-wrapped;
 * - fixed mode: width = fixedWidth, every explicit line wrapped at it.
 * height = line count × TEXT_SIZES[size] × TEXT_LINE_HEIGHT.
 * Explicit newlines always produce new lines.
 */
export function layoutText(
  text: string,
  size: TextSize,
  mode: TextWidthMode,
  fixedWidth: number | null,
  measure: Measurer,
): { width: number; height: number; lines: string[] } {
  const fontPx = TEXT_SIZES[size];
  const fixed = mode === 'fixed' && fixedWidth !== null && Number.isFinite(fixedWidth);
  const limit = fixed ? Math.max(fixedWidth, 0) : TEXT_MAX_AUTO_WIDTH_WORLD;

  if (text === '') return { width: 0, height: 0, lines: [] };

  const explicitLines = text.split('\n');
  const lines: string[] = [];
  for (const explicit of explicitLines) {
    lines.push(...wrapLine(explicit, limit, measure, fontPx));
  }

  // Auto: width = longest line up to the cap — a line that needed wrapping
  // makes the box exactly the cap (text.auto_width). Fixed: the pinned width.
  const width = fixed
    ? limit
    : Math.min(TEXT_MAX_AUTO_WIDTH_WORLD, Math.max(...explicitLines.map((l) => measure(l, fontPx))));
  const height = lines.length * fontPx * TEXT_LINE_HEIGHT;
  return { width, height, lines };
}

/**
 * A canvas-based measurer: `ctx.measureText` at `${fontPx}px ${fontFamily}`
 * (font sizes are board/world units, so the result is world units). Without
 * a usable 2d context (node/jsdom, exotic browsers) falls back to a
 * character-count estimate (avg glyph width ratio × fontPx) — never throws.
 */
export function createCanvasMeasurer(fontFamily?: string): Measurer {
  const family = fontFamily ?? 'Inter, system-ui, sans-serif';
  // The minimal surface both 2d context flavours share (canvas and
  // OffscreenCanvas contexts differ slightly in their TS types).
  type MeasuringContext = { font: string; measureText(t: string): { width: number } };
  let ctx: MeasuringContext | null | undefined; // undefined = not probed
  const probe = (): MeasuringContext | null => {
    if (ctx !== undefined) return ctx;
    ctx = null;
    try {
      if (typeof OffscreenCanvas !== 'undefined') {
        const c = new OffscreenCanvas(8, 8).getContext('2d');
        if (c) ctx = c;
      } else if (typeof document !== 'undefined') {
        const c = document.createElement('canvas').getContext('2d');
        if (c) ctx = c;
      }
    } catch {
      ctx = null;
    }
    return ctx;
  };
  return (text, fontPx) => {
    const c = probe();
    if (c) {
      c.font = `${fontPx}px ${family}`;
      return c.measureText(text).width;
    }
    // Estimate fallback: average glyph width ratio × font size × char count.
    return text.length * fontPx * TEXT_AVG_GLYPH_WIDTH_RATIO;
  };
}
