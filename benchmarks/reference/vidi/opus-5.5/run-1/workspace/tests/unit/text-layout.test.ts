/**
 * text.layout (story 9): pure layoutText with a fake measurer, and the canvas measurer's
 * fallback. TC-07 to TC-11, TC-32.
 */
import { describe, expect, it } from 'vitest';
import {
  createCanvasMeasurer,
  estimateMeasurer,
  layoutText,
  type Measurer,
} from '../../src/client/objects/textLayout';
import {
  TEXT_AUTO_WIDTH_PADDING_WORLD,
  TEXT_FONT_FAMILY,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
} from '../../src/shared/config';

/** Fake: every character is half the font size wide (10 world units at M). */
const CHAR_RATIO = 0.5;
const fake: Measurer = (text, fontPx) => text.length * fontPx * CHAR_RATIO;
const CHAR_M = TEXT_SIZES.M * CHAR_RATIO;
const LINE_M = TEXT_SIZES.M * TEXT_LINE_HEIGHT;

/** Words of `word` separated by single spaces, exactly `chars` characters long in total. */
function wordsOf(chars: number, word = 'plan'): string {
  let s = word;
  while (s.length < chars) s += ` ${word}`;
  return s.slice(0, chars);
}

describe('text.layout layoutText', () => {
  it('TC-07 "Went well" measured 90 at M → width 90 + padding, one line high', () => {
    const measured = fake('Went well', TEXT_SIZES.M);
    expect(measured).toBe(90);
    const layout = layoutText('Went well', 'M', 'auto', null, fake);
    expect(layout).toEqual({ width: 90 + TEXT_AUTO_WIDTH_PADDING_WORLD, height: LINE_M, lines: ['Went well'] });
  });

  it('TC-08 a line measuring 900 → width TEXT_MAX_AUTO_WIDTH_WORLD, wrapped by words into 2 lines', () => {
    const text = wordsOf(900 / CHAR_M);
    expect(fake(text, TEXT_SIZES.M)).toBe(900);
    const layout = layoutText(text, 'M', 'auto', null, fake);
    expect(layout.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(layout.lines).toHaveLength(2);
    expect(layout.height).toBe(2 * LINE_M);
    // Greedy: the first line is as full as possible and breaks between words.
    expect(fake(layout.lines[0]!.trimEnd(), TEXT_SIZES.M)).toBeLessThanOrEqual(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(layout.lines.join('')).toBe(text);
    expect(layout.lines[1]!.startsWith('plan')).toBe(true);
  });

  it('TC-09 a line measuring exactly TEXT_MAX_AUTO_WIDTH_WORLD stays one line, width 600 (boundary)', () => {
    const text = wordsOf(TEXT_MAX_AUTO_WIDTH_WORLD / CHAR_M);
    expect(fake(text, TEXT_SIZES.M)).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    const layout = layoutText(text, 'M', 'auto', null, fake);
    expect(layout).toEqual({ width: TEXT_MAX_AUTO_WIDTH_WORLD, height: LINE_M, lines: [text] });
    // One character more wraps.
    expect(layoutText(`${text}s`, 'M', 'auto', null, fake).lines).toHaveLength(2);
  });

  it('TC-10 fixed width TEXT_MIN_WIDTH_WORLD with three words → one word per line, height 3 lines (boundary)', () => {
    const layout = layoutText('ab cd ef', 'M', 'fixed', TEXT_MIN_WIDTH_WORLD, fake);
    expect(layout.width).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(layout.lines.map((l) => l.trimEnd())).toEqual(['ab', 'cd', 'ef']);
    expect(layout.height).toBe(3 * LINE_M);
    // Below the minimum is treated as the minimum.
    expect(layoutText('ab cd ef', 'M', 'fixed', 10, fake)).toEqual(layout);
  });

  it('TC-11 explicit newlines: width = longest line, height = line count × size × TEXT_LINE_HEIGHT', () => {
    const text = 'Went well\nTo improve things\nOk';
    const layout = layoutText(text, 'L', 'auto', null, fake);
    const longest = fake('To improve things', TEXT_SIZES.L);
    expect(layout.width).toBe(longest + TEXT_AUTO_WIDTH_PADDING_WORLD);
    expect(layout.lines).toEqual(['Went well', 'To improve things', 'Ok']);
    expect(layout.height).toBe(3 * TEXT_SIZES.L * TEXT_LINE_HEIGHT);
    // A trailing newline is a new (empty) line.
    expect(layoutText('Went well\n', 'M', 'auto', null, fake).height).toBe(2 * LINE_M);
  });

  it('empty text is one empty line, padding wide', () => {
    expect(layoutText('', 'M', 'auto', null, fake)).toEqual({
      width: TEXT_AUTO_WIDTH_PADDING_WORLD,
      height: LINE_M,
      lines: [''],
    });
  });

  it('a word wider than a fixed width is broken between characters', () => {
    const layout = layoutText('abcdefghij', 'M', 'fixed', TEXT_MIN_WIDTH_WORLD, fake);
    expect(layout.lines).toEqual(['abcd', 'efgh', 'ij']);
  });

  it('fixed width rewraps and the size changes the height', () => {
    const text = wordsOf(300 / CHAR_M);
    const m = layoutText(text, 'M', 'fixed', 100, fake);
    const xl = layoutText(text, 'XL', 'fixed', 100, fake);
    expect(m.width).toBe(100);
    expect(xl.width).toBe(100);
    expect(xl.lines.length).toBeGreaterThan(m.lines.length);
  });
});

describe('text.layout createCanvasMeasurer', () => {
  it('TC-32 without a canvas (node) falls back to the character-count estimate and never throws', () => {
    expect(typeof OffscreenCanvas).toBe('undefined');
    expect(typeof document).toBe('undefined');
    let measure: Measurer | undefined;
    expect(() => {
      measure = createCanvasMeasurer(TEXT_FONT_FAMILY);
    }).not.toThrow();
    expect(measure!('Went well', TEXT_SIZES.M)).toBe(estimateMeasurer('Went well', TEXT_SIZES.M));
    expect(measure!('Went well', TEXT_SIZES.M)).toBeGreaterThan(0);
    const layout = layoutText('Went well', 'M', 'auto', null, measure!);
    expect(layout.width).toBeGreaterThan(TEXT_AUTO_WIDTH_PADDING_WORLD);
    expect(layout.height).toBe(LINE_M);
  });
});
