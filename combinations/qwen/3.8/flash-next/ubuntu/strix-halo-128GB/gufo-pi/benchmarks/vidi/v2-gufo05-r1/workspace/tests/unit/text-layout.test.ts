/**
 * The pure text layout (`text.layout`), with a fake measurer.
 *
 * The measurer is the only input the layout cannot compute itself, so the test
 * hands it one: every character is half a font wide, which makes the arithmetic
 * readable — at size M (20 board units) a character is 10 units, so a 60-unit line
 * is six characters.
 *
 * TC-07 short text, auto width  → width = measured line + box slack, one line tall
 * TC-08 a line over the cap     → wrapped, and the box is exactly the cap
 * TC-09 a line of exactly the cap → one line, width exactly the cap
 * TC-10 fixed width             → wraps at the width it was given, height follows
 * TC-11 explicit newlines       → each source line is laid out on its own
 * TC-32 no canvas to measure with → a character-count estimate, and no throw
 */
import { describe, expect, it } from 'vitest';

import {
  TEXT_BOX_SLACK_WORLD,
  TEXT_FALLBACK_GLYPH_RATIO,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
} from '../../src/shared/config';
import { emptyTextBox } from '../../src/shared/objects/text';
import { createCanvasMeasurer, layoutText, type Measurer } from '../../src/client/objects/textLayout';

/** Every character is half a font wide, so a 90-unit line is nine characters at M. */
const measure: Measurer = (text, fontPx) => text.length * fontPx * 0.5;

/** How many board units `characters` occupies at size M. */
const units = (characters: number): number => characters * TEXT_SIZES.M * 0.5;

/** The height of `lines` lines at size M. */
const tall = (lines: number): number => lines * TEXT_SIZES.M * TEXT_LINE_HEIGHT;

describe('text.layout: automatic width', () => {
  it('TC-07 measures the line and adds the box slack', () => {
    const layout = layoutText('Went well', 'M', 'auto', null, measure);

    expect(measure('Went well', TEXT_SIZES.M)).toBe(90);
    expect(layout.width).toBe(90 + TEXT_BOX_SLACK_WORLD);
    expect(layout.height).toBe(tall(1));
    expect(layout.lines).toEqual(['Went well']);
  });

  it('TC-08 breaks a line wider than the maximum and caps the box at it', () => {
    // 45 + 1 + 44 characters, 90 units wide per the fake measurer, so it has to
    // break: 45 characters (450 units) fit in 600 and adding the second word would
    // not, which is the greedy rule with no rounding to argue about.
    const text = `${'x'.repeat(45)} ${'y'.repeat(44)}`;
    const layout = layoutText(text, 'M', 'auto', null, measure);

    expect(layout.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(layout.lines).toHaveLength(2);
    expect(layout.lines[0]).toBe('x'.repeat(45));
    expect(layout.lines[1]).toBe('y'.repeat(44));
    expect(layout.height).toBe(tall(2));
  });

  it('TC-09 a line exactly as wide as the maximum is one line, exactly that wide', () => {
    const text = `${'x'.repeat(29)} ${'y'.repeat(30)}`; // 60 characters, 600 units
    expect(measure(text, TEXT_SIZES.M)).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);

    const layout = layoutText(text, 'M', 'auto', null, measure);
    expect(layout.lines).toHaveLength(1);
    expect(layout.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(layout.height).toBe(tall(1));
  });

  it('sizes itself by the widest line, not the last one typed', () => {
    const layout = layoutText('a\nabcdefghij\nab', 'M', 'auto', null, measure);
    expect(layout.width).toBe(units(10) + TEXT_BOX_SLACK_WORLD);
    expect(layout.height).toBe(tall(3));
  });

  it('leaves an empty box one caret wide and one line tall, as the model created it', () => {
    const layout = layoutText('', 'M', 'auto', null, measure);
    // A client that measures an empty text object must agree with the client that
    // created it, or every mount would write a box and sync it.
    expect(layout.width).toBe(emptyTextBox().width);
    expect(layout.height).toBe(emptyTextBox().height);
  });

  it('measures height in the size that is set, not the default', () => {
    const layout = layoutText('two\nlines', 'XL', 'auto', null, measure);
    expect(layout.height).toBe(2 * TEXT_SIZES.XL * TEXT_LINE_HEIGHT);
    // A bigger font makes a wider box out of the same characters.
    const small = layoutText('two\nlines', 'S', 'auto', null, measure);
    expect(small.width).toBeLessThan(layout.width);
    expect(small.height).toBeLessThan(layout.height);
  });
});

describe('text.layout: fixed width', () => {
  it('TC-10 wraps at the width a person dragged to', () => {
    // 40 units hold three characters, so 'aaa bbb ccc' is three lines; the space
    // that would have joined them is not kept at the end of a line.
    const layout = layoutText('aaa bbb ccc', 'M', 'fixed', 40, measure);

    expect(layout.width).toBe(40);
    expect(layout.lines).toEqual(['aaa', 'bbb', 'ccc']);
    expect(layout.height).toBe(tall(3));
  });

  it('keeps the width it is given even when the content is shorter', () => {
    const layout = layoutText('hi', 'M', 'fixed', 300, measure);
    expect(layout.width).toBe(300);
    expect(layout.height).toBe(tall(1));
  });

  it('breaks a single word that cannot fit, rather than overflowing', () => {
    const layout = layoutText('abcdefghijklmno', 'M', 'fixed', TEXT_MIN_WIDTH_WORLD, measure);
    // 40 units is four characters at M; fifteen characters are four lines.
    expect(layout.lines).toHaveLength(4);
    for (const line of layout.lines) {
      expect(measure(line, TEXT_SIZES.M)).toBeLessThanOrEqual(TEXT_MIN_WIDTH_WORLD);
    }
    // No character is lost or duplicated on the way.
    expect(layout.lines.join('')).toBe('abcdefghijklmno');
    expect(layout.height).toBe(tall(4));
  });

  it('wraps each source line of its own, so a newline still breaks', () => {
    const layout = layoutText('a\nbbbbbbbbbb\nc', 'M', 'fixed', 40, measure);
    expect(layout.lines).toEqual(['a', 'bbbb', 'bbbb', 'bb', 'c']);
    expect(layout.height).toBe(tall(5));
  });
});

describe('text.layout: newlines and blank lines', () => {
  it('TC-11 keeps three source lines three lines tall', () => {
    const layout = layoutText('ab\ncdef\nghi', 'M', 'auto', null, measure);
    expect(layout.lines).toEqual(['ab', 'cdef', 'ghi']);
    expect(layout.width).toBe(units(4) + TEXT_BOX_SLACK_WORLD);
    expect(layout.height).toBe(tall(3));
  });

  it('keeps a blank line blank rather than joining the lines around it', () => {
    const layout = layoutText('one\n\ntwo', 'M', 'auto', null, measure);
    expect(layout.lines).toEqual(['one', '', 'two']);
    expect(layout.height).toBe(tall(3));
  });

  it('treats a trailing newline as the empty line it is', () => {
    const layout = layoutText('text\n', 'M', 'auto', null, measure);
    expect(layout.lines).toEqual(['text', '']);
    expect(layout.height).toBe(tall(2));
  });
});

/**
 * TC-32: the measurer is optional in the sense that it is allowed to fail.
 *
 * A unit test runs with no browser at all, a jsdom without a canvas package is
 * the same to the code, and a Worker has neither. Sizing text from a character
 * count is the difference between a box with the right shape and no box.
 */
describe('text.layout: no canvas', () => {
  it('TC-32 estimates from the character count instead of throwing', () => {
    const estimate = createCanvasMeasurer(); // no document, no canvas, no throw

    expect(estimate('abc', 20)).toBe(3 * 20 * TEXT_FALLBACK_GLYPH_RATIO);
    expect(estimate('', 20)).toBe(0);
    expect(estimate('abcdef', 20)).toBe(estimate('abc', 20) * 2);
  });

  it('still lays text out with the estimate', () => {
    const estimate = createCanvasMeasurer('Inter, system-ui, sans-serif');
    const layout = layoutText('aaa bbb ccc', 'M', 'fixed', 40, estimate);
    expect(layout.lines).toEqual(['aaa', 'bbb', 'ccc']);
    expect(layout.height).toBeGreaterThan(0);
    expect(Number.isFinite(layout.width)).toBe(true);
  });

  it('never returns a box that is not a box, whatever the text', () => {
    for (const text of ['', '\n\n\n', 'x'.repeat(5000), '👩‍👩‍👧‍👦 family'.repeat(30)]) {
      const layout = layoutText(text, 'L', 'auto', null, createCanvasMeasurer());
      expect(layout.width).toBeGreaterThan(0);
      expect(layout.height).toBeGreaterThan(0);
      expect(Number.isFinite(layout.width)).toBe(true);
      expect(Number.isFinite(layout.height)).toBe(true);
    }
  });
});
