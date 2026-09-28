// Unit tests for the pure text layout (story 9, text.layout): TC-07 to
// TC-11 and TC-32, with a deterministic fake measurer (10 world units per
// character, independent of font size) so the wrapping maths is exact.

import { describe, expect, it } from 'vitest';
import {
  TEXT_GLYPH_WIDTH_RATIO,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_PADDING_WORLD,
  TEXT_SIZES,
} from '../../src/shared/config';
import { createCanvasMeasurer, layoutText, type Measurer } from '../../src/client/objects/textLayout';

/** Deterministic fake: 10 world units per character. */
const measure: Measurer = (text) => text.length * 10;

const LINE_M = TEXT_SIZES.M * TEXT_LINE_HEIGHT; // 26

describe('text.layout: auto width (fake measurer, 10 units/char)', () => {
  it('TC-07: "Went well" at M → width = measured line + padding, height one line', () => {
    const layout = layoutText('Went well', 'M', 'auto', null, measure);
    expect(layout.width).toBe(9 * 10 + 2 * TEXT_PADDING_WORLD); // 90 + 8
    expect(layout.height).toBe(LINE_M); // one line
    expect(layout.lines).toEqual(['Went well']);
  });

  it('TC-08: line measuring 900 → width TEXT_MAX_AUTO_WIDTH_WORLD, greedy word wrap into 2 lines, height 2 lines', () => {
    // 7 words × 12 chars + 6 spaces = 90 chars → measures 900.
    const word = 'a'.repeat(12);
    const line = Array(7).fill(word).join(' ');
    expect(measure(line, 20)).toBe(900);

    const layout = layoutText(line, 'M', 'auto', null, measure);

    expect(layout.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(layout.lines).toHaveLength(2);
    // Greedy: as many whole words as fit per line.
    expect(layout.lines[0]).toBe([word, word, word, word].join(' '));
    expect(layout.lines[1]).toBe([word, word, word].join(' '));
    expect(layout.height).toBe(2 * LINE_M);
  });

  it('TC-09: line measuring exactly 600 → one line, width 600 (boundary)', () => {
    const line = 'a'.repeat(60); // measures exactly 600
    const layout = layoutText(line, 'M', 'auto', null, measure);
    expect(layout.lines).toHaveLength(1);
    expect(layout.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(layout.height).toBe(LINE_M);
  });

  it('explicit newlines are respected: width = longest line, height = line count (TC-11)', () => {
    const layout = layoutText('aa\nbbb', 'M', 'auto', null, measure);
    expect(layout.lines).toEqual(['aa', 'bbb']);
    expect(layout.width).toBe(3 * 10 + 2 * TEXT_PADDING_WORLD); // longest = "bbb"
    expect(layout.height).toBe(2 * LINE_M);
  });

  it('empty text: one (empty) line, minimum box, no throw', () => {
    const layout = layoutText('', 'M', 'auto', null, measure);
    expect(layout.lines).toEqual(['']);
    expect(layout.width).toBe(2 * TEXT_PADDING_WORLD);
    expect(layout.height).toBe(LINE_M);
  });

  it('height follows the size preset (TC-11 generalised)', () => {
    const layout = layoutText('aa\nbbb\ncccc', 'XL', 'auto', null, measure);
    expect(layout.height).toBe(3 * TEXT_SIZES.XL * TEXT_LINE_HEIGHT);
  });
});

describe('text.layout: fixed width (fake measurer)', () => {
  it('TC-10: fixed width TEXT_MIN_WIDTH_WORLD with three words → one word per line, height 3 lines (boundary)', () => {
    const layout = layoutText('one two three', 'M', 'fixed', TEXT_MIN_WIDTH_WORLD, measure);
    expect(layout.width).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(layout.lines).toEqual(['one', 'two', 'three']);
    expect(layout.height).toBe(3 * LINE_M);
  });

  it('fixed width rewraps multi-line text at the fixed width', () => {
    // Inner width = 100 - 8 = 92 → 9.2 chars; "aaaa bbbb cccc" (14 chars)
    // wraps as "aaaa bbbb" (11 → no) ... "aaaa"(4)+1+"bbbb"(4)=9 ≤ 9.2,
    // next word → 9+1+4=14 > 9.2 → line 2.
    const layout = layoutText('aaaa bbbb cccc', 'M', 'fixed', 100, measure);
    expect(layout.width).toBe(100);
    expect(layout.lines).toEqual(['aaaa bbbb', 'cccc']);
    expect(layout.height).toBe(2 * LINE_M);
  });

  it('a single word longer than the limit takes its own line (overflow, never split)', () => {
    const layout = layoutText('aaaaaaaaaaaaaaaa', 'M', 'fixed', TEXT_MIN_WIDTH_WORLD, measure);
    expect(layout.lines).toEqual(['aaaaaaaaaaaaaaaa']);
    expect(layout.width).toBe(TEXT_MIN_WIDTH_WORLD);
  });
});

describe('text.layout: canvas measurer fallback', () => {
  it('TC-32: environment without canvas → character-count estimate, no throw (error path)', () => {
    // Node environment: no document, no OffscreenCanvas.
    const m = createCanvasMeasurer();
    expect(() => m('hello', 20)).not.toThrow();
    // The estimate: length × font size × the named glyph-width ratio.
    expect(m('hello', 20)).toBe(5 * 20 * TEXT_GLYPH_WIDTH_RATIO);
    expect(m('', 20)).toBe(0);
  });

  it('createCanvasMeasurer honours the font family argument (no throw)', () => {
    const m = createCanvasMeasurer('Inter, system-ui, sans-serif');
    expect(() => m('abc', 14)).not.toThrow();
  });
});
