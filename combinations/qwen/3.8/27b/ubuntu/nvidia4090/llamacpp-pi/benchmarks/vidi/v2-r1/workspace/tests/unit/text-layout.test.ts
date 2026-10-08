// Story 9 unit tests: the pure text layout maths (TC-07 to TC-11, TC-32).
//
// A deterministic fake measurer (fixed world units per character, scaled by
// the font size) makes the wrap/box math exact: no canvas, no fonts, no
// environment. TC-32 covers the real measurer's fallback in an environment
// without canvas.

import { describe, it, expect } from 'vitest';
import {
  layoutText,
  createCanvasMeasurer,
  type Measurer,
} from '../../src/client/objects/textLayout';
import {
  TEXT_ESTIMATED_GLYPH_RATIO,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
} from '../../src/shared/config';

/** 10 world units per character at size M (20 px), scaled with the font. */
const fakeMeasure: Measurer = (text, fontPx) => text.length * (fontPx / 2);

const LINE = TEXT_SIZES.M * TEXT_LINE_HEIGHT; // one line at M

describe('text layout (unit)', () => {
  it('TC-07: a short single line in auto mode yields its measured width and one line of height', () => {
    // 'Went well' is 9 characters → 90 world units at M.
    const layout = layoutText('Went well', 'M', 'auto', null, fakeMeasure);
    expect(layout.width).toBe(90);
    expect(layout.height).toBe(LINE);
    expect(layout.lines).toEqual(['Went well']);
  });

  it('TC-08: a line wider than the auto maximum wraps and caps the width at the maximum', () => {
    // 11 words of 5 characters: 65 chars → 650 units. The first ten words
    // (60 chars, exactly 600 units) fit on line one; the eleventh wraps.
    const line = `${'abcde '.repeat(10)}abcde`;
    expect(line.length).toBe(65);
    const layout = layoutText(line, 'M', 'auto', null, fakeMeasure);
    expect(layout.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(layout.lines).toHaveLength(2);
    expect(layout.lines[0]).toBe('abcde '.repeat(10).trimEnd());
    expect(layout.lines[1]).toBe('abcde');
    expect(layout.height).toBe(2 * LINE);

    // A single word longer than the maximum overflows on its own line —
    // it is never split mid-word.
    const longWord = 'w'.repeat(90); // 900 units
    const overflow = layoutText(longWord, 'M', 'auto', null, fakeMeasure);
    expect(overflow.lines).toEqual([longWord]);
    expect(overflow.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(overflow.height).toBe(LINE);
  });

  it('TC-09: a line measuring exactly the auto maximum is one line at the maximum width (boundary)', () => {
    // 60 characters at M → exactly 600 units.
    const line = 'abcdef'.repeat(10);
    const layout = layoutText(line, 'M', 'auto', null, fakeMeasure);
    expect(layout.lines).toEqual([line]);
    expect(layout.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(layout.height).toBe(LINE);
  });

  it('TC-10: a fixed width below the word width puts one word per line (boundary)', () => {
    // Each 5-character word measures 50 units > TEXT_MIN_WIDTH_WORLD (40),
    // so every word gets its own line; the width is the fixed width.
    const layout = layoutText('abcde abcde abcde', 'M', 'fixed', TEXT_MIN_WIDTH_WORLD, fakeMeasure);
    expect(layout.width).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(layout.lines).toEqual(['abcde', 'abcde', 'abcde']);
    expect(layout.height).toBe(3 * LINE);
  });

  it('TC-11: explicit newlines are respected; width is the longest line, height the line count', () => {
    const layout = layoutText('a\nbb\nccc', 'M', 'auto', null, fakeMeasure);
    expect(layout.lines).toEqual(['a', 'bb', 'ccc']);
    expect(layout.width).toBe(30); // longest line: 'ccc' → 30 units
    expect(layout.height).toBe(3 * LINE);
  });

  it('TC-32: without a canvas the measurer falls back to an estimate and never throws', () => {
    // Node (and jsdom) have no OffscreenCanvas or 2D context: the factory
    // must return the character-count estimate, not throw.
    const measure = createCanvasMeasurer();
    expect(() => measure('abc', TEXT_SIZES.M)).not.toThrow();
    expect(measure('abc', TEXT_SIZES.M)).toBe(
      3 * TEXT_SIZES.M * TEXT_ESTIMATED_GLYPH_RATIO,
    );

    // And layoutText works end to end with the fallback.
    const layout = layoutText('hello world', 'M', 'auto', null, measure);
    expect(layout.lines).toHaveLength(1);
    expect(layout.width).toBe(11 * TEXT_SIZES.M * TEXT_ESTIMATED_GLYPH_RATIO);
    expect(layout.height).toBe(LINE);
  });
});
