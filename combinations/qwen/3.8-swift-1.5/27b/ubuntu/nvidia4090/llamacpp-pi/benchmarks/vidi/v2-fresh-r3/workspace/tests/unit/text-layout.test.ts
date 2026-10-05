import { describe, it, expect } from 'vitest';
import {
  layoutText,
  createCanvasMeasurer,
  type Measurer,
} from '../../src/client/objects/textLayout';
import {
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
  TEXT_LINE_HEIGHT,
  TEXT_PADDING_WORLD,
} from '../../src/shared/config';

/**
 * Deterministic fake measurer: 10 world units per character, at every font
 * size. A 60-character line therefore measures exactly 600 (the auto cap).
 */
const fakeMeasure: Measurer = (text) => text.length * 10;

const lineH = (size: 'S' | 'M' | 'L' | 'XL') => TEXT_SIZES[size] * TEXT_LINE_HEIGHT;

describe('text.layout (unit, fake measurer)', () => {
  it('TC-07: "Went well" at M, auto → width = measured line + padding, height one line', () => {
    const box = layoutText('Went well', 'M', 'auto', null, fakeMeasure);
    // 9 chars × 10 = 90 measured
    expect(box.width).toBe(90 + TEXT_PADDING_WORLD);
    expect(box.height).toBe(lineH('M'));
    expect(box.lines).toEqual(['Went well']);
  });

  it('TC-08: line measuring 900 → width TEXT_MAX_AUTO_WIDTH_WORLD, wraps to 2 lines', () => {
    // 60-char word (600) + 29 more chars → the whole line measures 900.
    const line = 'x'.repeat(60) + ' ' + 'a'.repeat(15) + ' ' + 'a'.repeat(13);
    expect(line.length * 10).toBe(900);

    const box = layoutText(line, 'M', 'auto', null, fakeMeasure);
    expect(box.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(box.lines).toHaveLength(2);
    expect(box.lines[0]).toBe('x'.repeat(60));
    expect(box.lines[1]).toBe('a'.repeat(15) + ' ' + 'a'.repeat(13));
    expect(box.height).toBe(2 * lineH('M'));
  });

  it('TC-09: line measuring exactly 600 → one line, width 600 (boundary)', () => {
    const line = 'x'.repeat(60); // 600 units
    const box = layoutText(line, 'M', 'auto', null, fakeMeasure);
    expect(box.lines).toHaveLength(1);
    expect(box.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(box.height).toBe(lineH('M'));
  });

  it('TC-10: fixed width TEXT_MIN_WIDTH_WORLD with 3 words → one word per line, height 3 lines', () => {
    // Words measure 30, 40, 50; any pair exceeds 40.
    const box = layoutText('one two three', 'M', 'fixed', TEXT_MIN_WIDTH_WORLD, fakeMeasure);
    expect(box.width).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(box.lines).toEqual(['one', 'two', 'three']);
    expect(box.height).toBe(3 * lineH('M'));
  });

  it('TC-11: explicit newlines → width = longest line, height = lines × size × TEXT_LINE_HEIGHT', () => {
    const box = layoutText('abc\ndefgh', 'M', 'auto', null, fakeMeasure);
    expect(box.lines).toEqual(['abc', 'defgh']);
    expect(box.width).toBe(50 + TEXT_PADDING_WORLD); // longest line: 5 chars
    expect(box.height).toBe(2 * lineH('M'));
  });

  it('TC-32: createCanvasMeasurer without canvas → estimate fallback, no throw (error path)', () => {
    // Node test environment: no canvas, no document.
    const measure = createCanvasMeasurer();
    expect(() => measure('hello world', 20)).not.toThrow();
    const w = measure('hello world', 20);
    expect(w).toBeGreaterThan(0);
    // The estimate scales with font size
    expect(measure('hello world', 40)).toBeGreaterThan(w);
    // layoutText with the estimate measurer never throws
    const box = layoutText('some annotation text', 'L', 'auto', null, measure);
    expect(box.width).toBeGreaterThan(0);
    expect(box.height).toBe(lineH('L'));
  });

  it('empty text → one (empty) line, height one line, width the padding', () => {
    const box = layoutText('', 'M', 'auto', null, fakeMeasure);
    expect(box.lines).toEqual(['']);
    expect(box.width).toBe(TEXT_PADDING_WORLD);
    expect(box.height).toBe(lineH('M'));
  });

  it('greedy word wrap keeps words intact and fills each line as far as it can', () => {
    // 11-char words: 5 words + 4 spaces = 59 chars = 590 ≤ 600,
    // 6 words + 5 spaces = 71 chars = 710 > 600.
    const word = 'a'.repeat(11);
    const line = Array.from({ length: 8 }, () => word).join(' ');
    const box = layoutText(line, 'M', 'auto', null, fakeMeasure);
    expect(box.lines).toEqual([
      [word, word, word, word, word].join(' '),
      [word, word, word].join(' '),
    ]);
    expect(box.width).toBe(590 + TEXT_PADDING_WORLD);
    expect(box.height).toBe(2 * lineH('M'));
  });
});
