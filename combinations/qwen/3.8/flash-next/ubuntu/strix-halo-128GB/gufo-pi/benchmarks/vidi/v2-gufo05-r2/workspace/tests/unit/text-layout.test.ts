/**
 * Story 9, `text.layout`: the pure box maths of a text object.
 *
 * A fake measurer (a fixed number of board units per character at each font
 * size) makes the arithmetic exact: 10 units per character at size M, so a
 * 9-character line is 90 wide, and the limits in `config.ts` land on round
 * numbers that can be asserted rather than approximated.
 */

import { describe, expect, it } from 'vitest';

import {
  TEXT_AUTO_WIDTH_PAD_WORLD,
  TEXT_ESTIMATED_GLYPH_RATIO,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
  type TextSize,
} from '../../src/shared/config';
import {
  createCanvasMeasurer,
  layoutText,
  type Measurer,
} from '../../src/client/objects/textLayout';

/** 10 board units per character at size M (0.5 × the font size), fake but stable. */
const measure: Measurer = (text, fontPx) => text.length * fontPx * 0.5;

/** Board units one line of `size` occupies. */
function lineHeight(size: TextSize): number {
  return TEXT_SIZES[size] * TEXT_LINE_HEIGHT;
}

const word = (length: number): string => 'x'.repeat(length);

describe('text.layout — automatic width', () => {
  it('TC-07: a short line is as wide as itself, one line tall', () => {
    const box = layoutText('Went well', 'M', 'auto', null, measure);
    expect(measure('Went well', TEXT_SIZES.M)).toBe(90);
    expect(box.width).toBe(90 + TEXT_AUTO_WIDTH_PAD_WORLD);
    expect(box.height).toBeCloseTo(lineHeight('M'), 6);
    expect(box.lines).toEqual(['Went well']);
  });

  it('TC-08: a line wider than the maximum wraps into two and is capped', () => {
    // 40 + 1 + 49 characters = 90 characters = 900 board units at size M.
    const text = `${word(40)} ${word(49)}`;
    expect(measure(text, TEXT_SIZES.M)).toBe(900);
    const box = layoutText(text, 'M', 'auto', null, measure);
    expect(box.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(box.lines).toHaveLength(2);
    expect(box.lines[0]).toBe(word(40));
    expect(box.lines[1]).toBe(word(49));
    expect(box.height).toBeCloseTo(2 * lineHeight('M'), 6);
  });

  it('TC-09: a line measuring exactly the maximum stays on one line at 600', () => {
    // 30 + 1 + 29 characters = 60 characters = exactly 600 board units at size M.
    const text = `${word(30)} ${word(29)}`;
    expect(measure(text, TEXT_SIZES.M)).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    const box = layoutText(text, 'M', 'auto', null, measure);
    expect(box.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(box.lines).toHaveLength(1);
    expect(box.height).toBeCloseTo(lineHeight('M'), 6);
  });

  it('just over the maximum wraps; just under does not (boundary)', () => {
    const under = `${word(30)} ${word(28)}`; // 590 wide
    expect(layoutText(under, 'M', 'auto', null, measure).lines).toHaveLength(1);
    const over = `${word(30)} ${word(30)}`; // 610 wide
    const box = layoutText(over, 'M', 'auto', null, measure);
    expect(box.lines).toHaveLength(2);
    expect(box.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
  });

  it('a word too long for the box is broken, the way the browser breaks it', () => {
    // One 90-character word at size M: 900 units in a 600-unit box → two lines.
    const box = layoutText(word(90), 'M', 'auto', null, measure);
    expect(box.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(box.lines).toEqual([word(60), word(30)]);
    expect(box.height).toBeCloseTo(2 * lineHeight('M'), 6);
  });

  it('TC-11: explicit newlines decide the lines; width follows the longest', () => {
    const box = layoutText('ab\ncdefgh\nijk', 'M', 'auto', null, measure);
    expect(box.lines).toEqual(['ab', 'cdefgh', 'ijk']);
    expect(box.width).toBe(measure('cdefgh', TEXT_SIZES.M) + TEXT_AUTO_WIDTH_PAD_WORLD);
    expect(box.height).toBeCloseTo(3 * lineHeight('M'), 6);
  });

  it('the size preset scales the box', () => {
    for (const size of ['S', 'M', 'L', 'XL'] as const) {
      const box = layoutText('Went well', size, 'auto', null, measure);
      expect(box.width).toBe(measure('Went well', TEXT_SIZES[size]) + TEXT_AUTO_WIDTH_PAD_WORLD);
      expect(box.height).toBeCloseTo(lineHeight(size), 6);
    }
  });

  it('empty text is one line, and still has a box', () => {
    const box = layoutText('', 'M', 'auto', null, measure);
    expect(box.lines).toEqual(['']);
    expect(box.width).toBeGreaterThan(0);
    expect(box.height).toBeCloseTo(lineHeight('M'), 6);
  });
});

describe('text.layout — fixed width', () => {
  it('TC-10: the minimum width puts one word per line and grows the height', () => {
    // At size M the minimum width fits exactly four characters, so each of these
    // four-character words takes a line of its own.
    const text = `${word(4)} ${word(4)} ${word(4)}`;
    expect(measure(text, TEXT_SIZES.M)).toBe(140);
    const box = layoutText(text, 'M', 'fixed', TEXT_MIN_WIDTH_WORLD, measure);
    expect(box.width).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(box.lines).toEqual([word(4), word(4), word(4)]);
    expect(box.height).toBeCloseTo(3 * lineHeight('M'), 6);
  });

  it('a fixed width rewraps without changing the number of characters', () => {
    const text = 'Went well, and the heading above it is bigger';
    const narrow = layoutText(text, 'M', 'fixed', 100, measure); // ten characters a line
    const wide = layoutText(text, 'M', 'fixed', 600, measure);
    expect(wide.lines).toHaveLength(1);
    expect(narrow.lines.length).toBeGreaterThan(wide.lines.length);
    expect(narrow.lines.join(' ')).toBe(text);
    expect(narrow.height).toBeGreaterThan(wide.height);
  });

  it('a fixed width breaks a word too long for it', () => {
    const box = layoutText(`${word(9)} rest`, 'M', 'fixed', 40, measure);
    expect(box.lines).toEqual([word(4), word(4), 'x', 'rest']);
  });

  it('fixed mode still respects explicit newlines', () => {
    const box = layoutText('one\ntwo', 'M', 'fixed', 400, measure);
    expect(box.lines).toEqual(['one', 'two']);
    expect(box.width).toBe(400);
  });
});

describe('text.layout — measurer', () => {
  it('TC-32: without a canvas the measurer estimates and never throws', () => {
    // The unit project runs on Node: there is no OffscreenCanvas and no document.
    const measured = createCanvasMeasurer();
    expect(() => measured('Went well', 20)).not.toThrow();
    expect(measured('', 20)).toBe(0);
    expect(measured('Went well', 20)).toBeCloseTo(
      9 * 20 * TEXT_ESTIMATED_GLYPH_RATIO,
      6,
    );
    // Scales with the font size, so the estimate is usable at every preset.
    expect(measured('Went well', 40)).toBeCloseTo(measured('Went well', 20) * 2, 6);
  });

  it('TC-32b: a canvas that cannot give a context also falls back to the estimate', () => {
    const original = globalThis.document;
    const created: unknown[] = [];
    // A DOM whose canvas has no 2d context, as jsdom has.
    globalThis.document = {
      createElement: (tag: string) => {
        created.push(tag);
        return { getContext: () => null };
      },
    } as unknown as Document;
    try {
      const measured = createCanvasMeasurer();
      expect(measured('abc', 10)).toBeCloseTo(3 * 10 * TEXT_ESTIMATED_GLYPH_RATIO, 6);
      expect(created).toContain('canvas');
    } finally {
      globalThis.document = original;
    }
  });

  it('a measurer that throws is answered with the estimate, not an exception', () => {
    const broken: Measurer = () => {
      throw new Error('no font metrics here');
    };
    expect(() => layoutText('Went well', 'M', 'auto', null, broken)).not.toThrow();
  });
});
