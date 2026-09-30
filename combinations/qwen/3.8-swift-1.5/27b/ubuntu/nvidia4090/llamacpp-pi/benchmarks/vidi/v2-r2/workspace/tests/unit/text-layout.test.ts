/**
 * Story 9: text.layout unit tests (TC-07 to TC-11, TC-32) with a
 * deterministic fake measurer (fixed world units per character, proportional
 * to font size).
 */
import { describe, it, expect } from 'vitest';
import {
  createCanvasMeasurer,
  layoutText,
  TEXT_BOX_PADDING,
  AVERAGE_GLYPH_WIDTH_RATIO,
  type Measurer,
} from '../../src/client/objects/textLayout';
import {
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_LINE_HEIGHT,
  TEXT_SIZES,
} from '../../src/shared/config';

/**
 * Fake measurer: 0.5 * fontPx world units per character. At M (20px) that is
 * 10 units/char, so "Went well" (9 chars) measures exactly 90 (TC-07).
 */
const fakeMeasure: Measurer = (text, fontPx) => text.length * fontPx * 0.5;

const M = TEXT_SIZES.M; // 20
const LINE_H = M * TEXT_LINE_HEIGHT; // 26

describe('text.layout (unit)', () => {
  it('TC-07: "Went well" at M, auto → width = measured (90) + padding, height one line', () => {
    const r = layoutText('Went well', 'M', 'auto', null, fakeMeasure);
    // "Went well" = 9 chars × 10 = 90 world units.
    expect(r.width).toBe(90 + 2 * TEXT_BOX_PADDING);
    expect(r.height).toBe(LINE_H);
    expect(r.lines).toEqual(['Went well']);
  });

  it('TC-08: a ~900-wide line → width capped at MAX_AUTO_WIDTH, wraps to 2 lines', () => {
    // 60-char word (600 units) + space + 30-char word (300 units) = 910 units.
    const line = 'w'.repeat(60) + ' ' + 'x'.repeat(30);
    expect(fakeMeasure(line, M)).toBeGreaterThan(TEXT_MAX_AUTO_WIDTH_WORLD);
    const r = layoutText(line, 'M', 'auto', null, fakeMeasure);
    expect(r.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(r.lines).toHaveLength(2);
    expect(r.height).toBe(2 * LINE_H);
    // The first wrapped line is the 600-unit word; the second is the rest.
    expect(r.lines[0]).toBe('w'.repeat(60));
    expect(r.lines[1]).toBe('x'.repeat(30));
  });

  it('TC-09: a line measuring exactly MAX_AUTO_WIDTH → one line, width = MAX (boundary)', () => {
    const line = 'w'.repeat(60); // 600 units exactly
    expect(fakeMeasure(line, M)).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    const r = layoutText(line, 'M', 'auto', null, fakeMeasure);
    expect(r.lines).toHaveLength(1);
    expect(r.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(r.height).toBe(LINE_H);
  });

  it('TC-10: fixed width MIN_WIDTH with three words → one word per line, height 3 lines', () => {
    const r = layoutText('alpha beta gamma', 'M', 'fixed', TEXT_MIN_WIDTH_WORLD, fakeMeasure);
    // Each word (≥40 units) exceeds the 40-unit width → its own line.
    expect(r.lines).toEqual(['alpha', 'beta', 'gamma']);
    expect(r.width).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(r.height).toBe(3 * LINE_H);
  });

  it('TC-11: explicit newlines → width = longest line, height = lines × size × line-height', () => {
    const r = layoutText('abc\ndefgh', 'M', 'auto', null, fakeMeasure);
    // "abc"=30, "defgh"=50 → longest 50.
    expect(r.lines).toEqual(['abc', 'defgh']);
    expect(r.width).toBe(50 + 2 * TEXT_BOX_PADDING);
    expect(r.height).toBe(2 * LINE_H);
  });

  it('TC-32: createCanvasMeasurer without canvas → estimate fallback, no throw', () => {
    // jsdom has no 2d canvas context, so the measurer must fall back to the
    // character-count estimate and never throw.
    const measure = createCanvasMeasurer();
    expect(() => measure('hello', 20)).not.toThrow();
    const w = measure('hello', 20);
    expect(Number.isFinite(w)).toBe(true);
    expect(w).toBe(5 * 20 * AVERAGE_GLYPH_WIDTH_RATIO);
    // Empty text measures 0.
    expect(measure('', 20)).toBe(0);
  });
});
