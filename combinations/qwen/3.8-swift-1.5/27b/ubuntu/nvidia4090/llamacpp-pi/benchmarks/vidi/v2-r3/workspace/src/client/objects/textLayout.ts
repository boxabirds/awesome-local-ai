import * as Y from 'yjs';
import {
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_SIZES,
  TEXT_LINE_HEIGHT,
  TEXT_FONT_FAMILY,
  isTextSize,
  type TextSize,
} from '../../shared/config';
import { setTextBox } from '../../shared/objects/text';

/**
 * Story 9 (text.auto_width, text.fixed_width): grow-then-wrap layout.
 *
 * A text object grows with its content up to `TEXT_MAX_AUTO_WIDTH_WORLD`;
 * beyond that (or at a user-chosen fixed width) it wraps with greedy word
 * wrap. The stored box is always `width × lines × fontPx × TEXT_LINE_HEIGHT`.
 */

/**
 * Measures the rendered width (world units) of `text` at `fontPx`.
 * `fontPx` is in world units (board units) — the same space the box lives in.
 */
export type Measurer = (text: string, fontPx: number) => number;

/**
 * Named estimate used when no canvas 2d context is available (workers,
 * non-DOM tests): character count × average glyph width ratio × font size.
 */
export const TEXT_AVG_GLYPH_RATIO = 0.6;

/**
 * Create the production measurer. Uses an offscreen canvas `measureText`
 * (2D context in the browser, OffscreenCanvas in workers) when available and
 * falls back to the character-count estimate otherwise, so layout code is
 * identical everywhere.
 */
export function createCanvasMeasurer(fontFamily: string = TEXT_FONT_FAMILY): Measurer {
  let ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null;
  try {
    if (typeof OffscreenCanvas !== 'undefined') {
      const c = new OffscreenCanvas(1, 1);
      ctx = c.getContext('2d');
    }
    if (!ctx && typeof document !== 'undefined') {
      const c = document.createElement('canvas');
      c.width = 1;
      c.height = 1;
      ctx = c.getContext('2d');
    }
  } catch {
    ctx = null;
  }

  if (!ctx) {
    return (text, fontPx) =>
      text.length === 0 ? 0 : text.length * TEXT_AVG_GLYPH_RATIO * fontPx;
  }

  return (text, fontPx) => {
    if (text.length === 0) return 0;
    ctx!.font = `${fontPx}px ${fontFamily}`;
    return ctx!.measureText(text).width;
  };
}

export interface TextLayout {
  /** Stored box width (world units). */
  width: number;
  /** Stored box height (world units). */
  height: number;
  /** The rendered lines (explicit + wrapped), for rendering/tests. */
  lines: string[];
}

/**
 * Greedy word wrap of one explicit line at `maxW` units. Words are separated
 * by single spaces; a word longer than `maxW` keeps its own line (it is
 * never split). Empty lines produce a single empty line.
 */
function wrapLine(line: string, maxW: number, measure: Measurer, fontPx: number): string[] {
  if (line.length === 0) return [''];
  const words = line.split(' ');
  const out: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current === '' ? word : `${current} ${word}`;
    if (current === '' || measure(candidate, fontPx) <= maxW) {
      current = candidate;
    } else {
      out.push(current);
      current = word;
    }
  }
  out.push(current);
  return out;
}

/**
 * Compute the text box for `text` at size preset `size`:
 * - auto mode: width = the longest line, up to TEXT_MAX_AUTO_WIDTH_WORLD;
 *   a line that EXCEEDS the cap wraps, and the box takes the cap itself
 *   (PRD: "pasting a 300-character sentence produces a 600-unit-wide box");
 * - fixed mode: width = `fixedWidth`, wrapping at that width;
 * - height = lines × TEXT_SIZES[size] × TEXT_LINE_HEIGHT (always).
 */
export function layoutText(
  text: string,
  size: TextSize,
  mode: 'auto' | 'fixed',
  fixedWidth: number | null,
  measure: Measurer,
): TextLayout {
  const fontPx = TEXT_SIZES[size];
  const cap = TEXT_MAX_AUTO_WIDTH_WORLD;
  const maxW =
    mode === 'fixed'
      ? fixedWidth != null && Number.isFinite(fixedWidth) && fixedWidth > 0
        ? fixedWidth
        : cap
      : cap;

  const paragraphs = text.split(/\r?\n/);
  const lines: string[] = [];
  let width = 0;
  for (const para of paragraphs) {
    if (mode === 'auto' && measure(para, fontPx) > cap) {
      // The line exceeds the cap: it wraps, and the box takes the cap.
      for (const l of wrapLine(para, cap, measure, fontPx)) lines.push(l);
      width = cap;
    } else {
      for (const l of wrapLine(para, maxW, measure, fontPx)) {
        lines.push(l);
        const w = measure(l, fontPx);
        if (w > width) width = w;
      }
    }
  }
  if (mode === 'fixed') width = maxW;
  const height = lines.length * fontPx * TEXT_LINE_HEIGHT;
  return { width, height, lines };
}

/** Tolerance for "the box is unchanged" (world units). */
const BOX_EPSILON = 1e-3;

/**
 * Story 9 (text box sync): the client-side bridge between the editor and the
 * stored box.
 *
 * Remote text changes (Yjs sync) are NOT measured by the receiving client —
 * the sender measures its own local changes and writes the box, which then
 * syncs. Only LOCAL changes call `remeasureTextObject`, which recomputes the
 * box with the shared layout function and writes it with `setTextBox` — at
 * most one box write per local change, and no write at all when the computed
 * box equals the stored box.
 */

/**
 * Pure remeasure: read the object's current content/size/mode from the doc,
 * compute the layout, and write the box only when it changed. Safe to call
 * with a stale id (no-op) and with no DOM (the measurer falls back to the
 * estimate).
 */
export function remeasureTextObject(doc: Y.Doc, id: string, measure: Measurer): void {
  const objects = doc.getMap('objects') as Y.Map<Y.Map<unknown>>;
  const m = objects.get(id);
  if (!m) return;
  const ytext = m.get('text');
  if (!(ytext instanceof Y.Text)) return;

  const sizeRaw = m.get('size');
  const size: TextSize = isTextSize(sizeRaw) ? sizeRaw : 'M';
  const widthMode = m.get('widthMode') === 'fixed' ? 'fixed' : 'auto';
  const storedW = m.get('width');
  const storedH = m.get('height');

  const layout = layoutText(
    ytext.toString(),
    size,
    widthMode,
    widthMode === 'fixed' && typeof storedW === 'number' && Number.isFinite(storedW) ? storedW : null,
    measure,
  );

  const sameBox =
    typeof storedW === 'number' &&
    typeof storedH === 'number' &&
    Math.abs(layout.width - storedW) <= BOX_EPSILON &&
    Math.abs(layout.height - storedH) <= BOX_EPSILON;
  if (sameBox) return;

  setTextBox(doc, id, { width: layout.width, height: layout.height });
}
