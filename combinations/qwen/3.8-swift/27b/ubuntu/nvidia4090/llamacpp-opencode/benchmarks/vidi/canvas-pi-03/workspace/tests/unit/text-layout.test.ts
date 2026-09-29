/**
 * Story 9 — text.layout (unit, TC-07 to TC-11, TC-32): the pure layoutText
 * with a deterministic fake measurer (10 world units per character) covering
 * auto width, the 600-unit wrap boundary, fixed-width wrapping, explicit
 * newlines, and the canvas-measurer estimate fallback.
 */
import { describe, it, expect } from 'vitest';
import {
  layoutText,
  createCanvasMeasurer,
  type Measurer,
} from 'src/client/objects/textLayout';
import {
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
  TEXT_LINE_HEIGHT,
  TEXT_AVG_GLYPH_WIDTH_RATIO,
} from 'src/shared/config';

/** Deterministic fake measurer: 10 world units per character. */
const measure: Measurer = (text, _fontPx) => text.length * 10;

const LINE = (n: number, size: number = TEXT_SIZES.M): number => n * size * TEXT_LINE_HEIGHT;

describe('text.layout: layoutText auto mode', () => {
  it('TC-07: "Went well" at M → width = measured line (90), height one line', () => {
    const out = layoutText('Went well', 'M', 'auto', null, measure);
    expect(out.width).toBe(90);
    expect(out.height).toBe(LINE(1));
    expect(out.lines).toEqual(['Went well']);
  });

  it('TC-08: a 900-unit line → width capped at TEXT_MAX_AUTO_WIDTH_WORLD, wrapped to 2 lines', () => {
    // 9 words of 10 chars + 8 spaces = 98 chars → 980 units (> 600).
    const longLine = Array.from({ length: 9 }, () => 'abcdefghij').join(' ');
    expect(measure(longLine, TEXT_SIZES.M)).toBe(980);

    const out = layoutText(longLine, 'M', 'auto', null, measure);
    expect(out.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(out.lines.length).toBeGreaterThan(1);
    expect(out.lines).toHaveLength(2); // 9×(100+10) needs 2 lines of 600
    expect(out.height).toBe(LINE(2));
    // No word is lost: unwrapped lines reconstruct the input.
    expect(out.lines.join(' ')).toBe(longLine);
  });

  it('TC-09: a line measuring exactly 600 → one line, width 600 (boundary)', () => {
    const line = 'a'.repeat(60); // 600 units exactly
    expect(measure(line, TEXT_SIZES.M)).toBe(600);
    const out = layoutText(line, 'M', 'auto', null, measure);
    expect(out.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(out.lines).toEqual([line]);
    expect(out.height).toBe(LINE(1));
  });

  it('TC-11: explicit newlines → width = longest line, height = line count', () => {
    const out = layoutText('aa\nbbbb\ncc', 'M', 'auto', null, measure);
    expect(out.width).toBe(40); // longest line 'bbbb' = 4 units
    expect(out.lines).toEqual(['aa', 'bbbb', 'cc']);
    expect(out.height).toBe(LINE(3));
  });

  it('longer sizes measure wider: the same line at XL wraps sooner', () => {
    const line = Array.from({ length: 9 }, () => 'abcdefghij').join(' '); // 980 at M
    const atM = layoutText(line, 'M', 'auto', null, measure);
    // Same fake measurer (font-agnostic) — height scales with the preset.
    const atXL = layoutText(line, 'XL', 'auto', null, measure);
    expect(atXL.height).toBe(LINE(2, TEXT_SIZES.XL));
    expect(atM.height).toBe(LINE(2, TEXT_SIZES.M));
    expect(atXL.lines).toEqual(atM.lines);
  });
});

describe('text.layout: layoutText fixed mode', () => {
  it('TC-10: fixed width 40 with three words → one word per line, height 3 lines (boundary)', () => {
    const out = layoutText('abc def ghi', 'M', 'fixed', TEXT_MIN_WIDTH_WORLD, measure);
    expect(out.width).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(out.lines).toEqual(['abc', 'def', 'ghi']);
    expect(out.height).toBe(LINE(3));
  });

  it('fixed width keeps explicit newlines and wraps each of them', () => {
    const out = layoutText('aa bb\ncc dd', 'M', 'fixed', 30, measure);
    expect(out.width).toBe(30);
    expect(out.lines).toEqual(['aa', 'bb', 'cc', 'dd']);
    expect(out.height).toBe(LINE(4));
  });

  it('empty text → zero box', () => {
    const out = layoutText('', 'M', 'auto', null, measure);
    expect(out.width).toBe(0);
    expect(out.height).toBe(0);
    expect(out.lines).toEqual([]);
  });
});

describe('text.layout: createCanvasMeasurer', () => {
  it('TC-32: without canvas (node) → estimate fallback, never throws', () => {
    const m = createCanvasMeasurer();
    expect(() => m('hello', 20)).not.toThrow();
    // Estimate: char count × fontPx × average glyph ratio.
    expect(m('hello', 20)).toBeCloseTo(5 * 20 * TEXT_AVG_GLYPH_WIDTH_RATIO);
    expect(m('', 20)).toBe(0);
  });

  it('estimate is linear in font size', () => {
    const m = createCanvasMeasurer();
    expect(m('ab', 40)).toBeCloseTo(2 * m('ab', 20));
  });
});
