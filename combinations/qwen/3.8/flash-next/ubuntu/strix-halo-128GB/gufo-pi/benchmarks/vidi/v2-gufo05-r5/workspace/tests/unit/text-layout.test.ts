/**
 * Text layout unit tests (TC-07 to TC-11, TC-32).
 *
 * The maths is pure: given a measurer, a size, a width mode and the characters, the box is
 * determined. The measurer here is a fake that charges half the font size per character, so
 * world units can be written out in the test - at size M (20 units) a character is 10 units
 * wide. Real fonts are measured by the canvas measurer, whose behaviour is proven in the e2e
 * suite where actual text wraps.
 */
import { describe, expect, test } from 'vitest';
import {
  createCanvasMeasurer,
  layoutText,
  type Measurer,
} from '../../src/client/objects/textLayout';
import {
  TEXT_BOX_PADDING_WORLD,
  TEXT_ESTIMATE_GLYPH_RATIO,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
} from '../../src/shared/config';

/** Half the font size per character: 10 world units at M, 28 at XL. */
const fake: Measurer = (text, fontPx) => text.length * (fontPx / 2);

/** How wide `n` characters are at size M with the fake measurer. */
const M = TEXT_SIZES.M;
const M_LINE = M * TEXT_LINE_HEIGHT;
const perCharM = M / 2;

/** A string of `words` single-letter-separated groups, `n` characters wide in total. */
function wordsWidthing(chars: number, gap: number): string {
  // two words separated by one space, together `chars` characters wide
  const left = chars - gap - Math.floor((chars - gap) / 2);
  return `${'a'.repeat(left)} ${'b'.repeat(chars - gap - left)}`;
}

describe('text.layout.auto', () => {
  test('TC-07 a short line is measured with padding, one line tall', () => {
    const box = layoutText('Went well', 'M', 'auto', null, fake);
    // 'Went well' is 9 characters: 9 × 10 = 90 units wide
    expect(box.width).toBeCloseTo(9 * perCharM + TEXT_BOX_PADDING_WORLD, 6);
    expect(box.height).toBeCloseTo(M_LINE, 6);
    expect(box.lines).toEqual(['Went well']);
  });

  test('TC-08 a line wider than the maximum wraps into two and the box is exactly the maximum', () => {
    const text = wordsWidthing(63, 1); // 63 characters: 630 units, past the 600 maximum
    const box = layoutText(text, 'M', 'auto', null, fake);

    expect(box.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(box.lines).toHaveLength(2);
    expect(box.lines[0]).toBe('a'.repeat(31));
    expect(box.lines[1]).toBe('b'.repeat(31));
    expect(box.height).toBeCloseTo(2 * M_LINE, 6);
  });

  test('TC-09 a line exactly at the maximum stays one line and is exactly the maximum wide', () => {
    const text = wordsWidthing(60, 1); // exactly 600 units: the boundary, so no wrapping
    const box = layoutText(text, 'M', 'auto', null, fake);

    expect(box.lines).toHaveLength(1);
    expect(box.lines[0]).toBe(text);
    expect(box.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(box.height).toBeCloseTo(M_LINE, 6);
  });

  test('just under the maximum is one line and as wide as the line plus padding', () => {
    const text = wordsWidthing(59, 1); // 590 units
    const box = layoutText(text, 'M', 'auto', null, fake);

    expect(box.lines).toHaveLength(1);
    expect(box.width).toBeCloseTo(59 * perCharM + TEXT_BOX_PADDING_WORLD, 6);
    expect(box.width).toBeLessThan(TEXT_MAX_AUTO_WIDTH_WORLD);
  });

  test('TC-11 explicit newlines are kept: width is the longest line, height the line count', () => {
    const box = layoutText(`aa
bbbb
cc`, 'M', 'auto', null, fake);

    expect(box.lines).toEqual(['aa', 'bbbb', 'cc']);
    expect(box.width).toBeCloseTo(4 * perCharM + TEXT_BOX_PADDING_WORLD, 6);
    expect(box.height).toBeCloseTo(3 * M_LINE, 6);
  });

  test('a long line after a short one wraps, and the other lines keep their own length', () => {
    const box = layoutText(`hi
${wordsWidthing(63, 1)}`, 'M', 'auto', null, fake);

    expect(box.lines).toEqual(['hi', 'a'.repeat(31), 'b'.repeat(31)]);
    expect(box.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(box.height).toBeCloseTo(3 * M_LINE, 6);
  });

  test('an empty text still has a box, no narrower than the minimum and one line tall', () => {
    const box = layoutText('', 'M', 'auto', null, fake);
    expect(box.width).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(box.height).toBeCloseTo(M_LINE, 6);
    expect(box.lines).toEqual(['']);
  });

  test('every size preset scales both width and height', () => {
    for (const size of Object.keys(TEXT_SIZES) as (keyof typeof TEXT_SIZES)[]) {
      const fontPx = TEXT_SIZES[size];
      const box = layoutText('abc', size, 'auto', null, fake);
      // at S the three characters are narrower than the minimum box, so the floor applies
      expect(box.width).toBeCloseTo(
        Math.max(TEXT_MIN_WIDTH_WORLD, 3 * (fontPx / 2) + TEXT_BOX_PADDING_WORLD),
        6,
      );
      expect(box.height).toBeCloseTo(fontPx * TEXT_LINE_HEIGHT, 6);
    }
  });
});

describe('text.layout.fixed', () => {
  test('TC-10 a fixed minimum width puts one word on each line and grows the height', () => {
    const box = layoutText('aaa bbb ccc', 'M', 'fixed', TEXT_MIN_WIDTH_WORLD, fake);

    expect(box.width).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(box.lines).toEqual(['aaa', 'bbb', 'ccc']);
    expect(box.height).toBeCloseTo(3 * M_LINE, 6);
  });

  test('a fixed width fits as many words as fit and never cuts a word', () => {
    // 96 units of usable width: 'aaa bbb' (70) fits, adding 'ccc' (110) does not
    const box = layoutText('aaa bbb ccc', 'M', 'fixed', 100, fake);
    expect(box.width).toBe(100);
    expect(box.lines).toEqual(['aaa bbb', 'ccc']);
    expect(box.height).toBeCloseTo(2 * M_LINE, 6);
  });

  test('a word wider than the fixed width stays whole on its own line and the layout terminates', () => {
    const box = layoutText(`supercalifragilistic
short`, 'M', 'fixed', TEXT_MIN_WIDTH_WORLD, fake);

    expect(box.lines).toEqual(['supercalifragilistic', 'short']);
    expect(box.width).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(box.height).toBeCloseTo(2 * M_LINE, 6);
  });

  test('a fixed width below the minimum is laid out at the minimum', () => {
    const box = layoutText('hello world', 'M', 'fixed', 10, fake);
    expect(box.width).toBe(TEXT_MIN_WIDTH_WORLD);
  });

  test('fixed width text with explicit newlines wraps each of them', () => {
    const box = layoutText(`aaa bbb
ccc`, 'M', 'fixed', TEXT_MIN_WIDTH_WORLD, fake);
    expect(box.lines).toEqual(['aaa', 'bbb', 'ccc']);
    expect(box.height).toBeCloseTo(3 * M_LINE, 6);
  });

  test('fixed mode never widens the box to the content', () => {
    const box = layoutText('a very long annotation that keeps going', 'M', 'fixed', 200, fake);
    expect(box.width).toBe(200);
    for (const line of box.lines) expect(fake(line, M)).toBeLessThanOrEqual(200);
  });
});

describe('text.layout.measurer', () => {
  test('TC-32 without a canvas the measurer estimates by character count and never throws', () => {
    const measure = createCanvasMeasurer();
    expect(() => measure('hello', 20)).not.toThrow();
    // the estimate is a named fraction of the font size per character
    expect(measure('hello', 20)).toBeCloseTo(5 * 20 * TEXT_ESTIMATE_GLYPH_RATIO, 6);
    expect(measure('', 20)).toBe(0);
    expect(measure('hello hello', 20)).toBeGreaterThan(measure('hello', 20));
    // an unusable font family string is not an error either
    expect(() => createCanvasMeasurer(undefined)('x', 16)).not.toThrow();
  });
});
