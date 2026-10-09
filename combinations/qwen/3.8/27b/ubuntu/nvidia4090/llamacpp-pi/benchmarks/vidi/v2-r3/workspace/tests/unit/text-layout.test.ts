/**
 * Story 9 unit tests (TC-07 to TC-11, TC-32): text layout with a fake
 * measurer (width = charCount × fontPx / 2, so 'Went well' at M = 90).
 */
import { describe, expect, it } from 'vitest';
import {
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_LINE_HEIGHT,
  TEXT_SIZES,
} from '../../src/shared/config';
import {
  createCanvasMeasurer,
  layoutText,
  type Measurer,
} from '../../src/client/objects/textLayout';

/** Deterministic fake: each character is half the font size wide. */
const measure: Measurer = (text, fontPx) => text.length * (fontPx / 2);

const LINE_M = TEXT_SIZES.M * TEXT_LINE_HEIGHT; // 26

describe('text.layout', () => {
  it('TC-07: auto width = the single line; height = font size × line height', () => {
    const m = layoutText('Went well', 'M', 'auto', null, measure);
    expect(m.width).toBe(90);
    expect(m.height).toBe(LINE_M);
    expect(m.lines).toEqual(['Went well']);
  });

  it('TC-08: a line wider than the auto cap wraps to 2 lines, width capped', () => {
    // 45 + 1 + 45 chars = 910 measured (> TEXT_MAX_AUTO_WIDTH_WORLD).
    const text = 'a'.repeat(45) + ' ' + 'a'.repeat(45);
    const m = layoutText(text, 'M', 'auto', null, measure);
    expect(m.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(m.lines).toHaveLength(2);
    expect(m.height).toBe(2 * LINE_M);
  });

  it('TC-09: a line measuring exactly the cap stays on one line', () => {
    // 60 chars = exactly TEXT_MAX_AUTO_WIDTH_WORLD measured.
    const text = 'a'.repeat(TEXT_MAX_AUTO_WIDTH_WORLD / (TEXT_SIZES.M / 2));
    const m = layoutText(text, 'M', 'auto', null, measure);
    expect(m.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(m.lines).toHaveLength(1);
    expect(m.height).toBe(LINE_M);
  });

  it('TC-10: fixed width 40 wraps three words onto three lines', () => {
    // Each 10-char word measures 100 > 40, so every word is alone.
    const m = layoutText('word word word', 'M', 'fixed', 40, measure);
    expect(m.width).toBe(40);
    expect(m.lines).toHaveLength(3);
    expect(m.height).toBe(3 * LINE_M);
  });

  it('TC-11: an explicit newline counts as a line', () => {
    const m = layoutText('ab\ncdef', 'M', 'auto', null, measure);
    expect(m.width).toBe(40); // widest line
    expect(m.height).toBe(2 * LINE_M);
    expect(m.lines).toEqual(['ab', 'cdef']);
  });

  it('fixed mode uses the given width even when the content is narrower', () => {
    const m = layoutText('a', 'M', 'fixed', 40, measure);
    expect(m.width).toBe(40);
    expect(m.height).toBe(LINE_M);
  });

  it('empty text has zero bounds', () => {
    const m = layoutText('', 'M', 'auto', null, measure);
    expect(m.width).toBe(0);
    expect(m.height).toBe(0);
    expect(m.lines).toEqual(['']);
  });

  it('TC-32: createCanvasMeasurer falls back to an estimate without a canvas', () => {
    const est = createCanvasMeasurer();
    expect(typeof est).toBe('function');
    const w = est('hello', 20);
    expect(Number.isFinite(w)).toBe(true);
    expect(w).toBeGreaterThan(0);
    // Wider font → wider estimate; empty text → 0.
    expect(est('hello', 40)).toBeGreaterThan(w);
    expect(est('', 20)).toBe(0);
  });
});
