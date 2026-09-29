// text.layout (TC-07 to TC-11, TC-32): pure layout with a fake measurer.
import { describe, expect, it } from 'vitest';
import {
  TEXT_CARET_SLACK_WORLD,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
} from '../../src/shared/config';
import {
  type Measurer,
  createCanvasMeasurer,
  estimateMeasurer,
  layoutText,
} from '../../src/client/objects/textLayout';

/** Fake measurer: every character is half the font size wide (10 units at M). */
const fake: Measurer = (text, fontPx) => text.length * fontPx * 0.5;
const lineHeight = (size: keyof typeof TEXT_SIZES) => TEXT_SIZES[size] * TEXT_LINE_HEIGHT;

describe('text.layout layoutText', () => {
  it('TC-07 "Went well" at M: measured width plus caret room, one line', () => {
    const box = layoutText('Went well', 'M', 'auto', null, fake);
    expect(fake('Went well', TEXT_SIZES.M)).toBe(90);
    expect(box.width).toBe(90 + TEXT_CARET_SLACK_WORLD);
    expect(box.height).toBeCloseTo(lineHeight('M'));
    expect(box.lines).toEqual(['Went well']);
  });

  it('TC-08 a line measuring 900 wraps at TEXT_MAX_AUTO_WIDTH_WORLD into 2 lines', () => {
    const text = Array.from({ length: 10 }, () => 'abcdefgh').join(' '); // 89 chars = 890
    const long = `${text} x`; // 91 chars = 910
    expect(fake(long, TEXT_SIZES.M)).toBeGreaterThanOrEqual(900);
    const box = layoutText(long, 'M', 'auto', null, fake);
    expect(box.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(box.lines).toHaveLength(2);
    for (const line of box.lines) {
      expect(fake(line.trimEnd(), TEXT_SIZES.M)).toBeLessThanOrEqual(TEXT_MAX_AUTO_WIDTH_WORLD);
    }
    expect(box.lines.join('')).toBe(long);
    expect(box.height).toBeCloseTo(2 * lineHeight('M'));
  });

  it('TC-09 a line measuring exactly TEXT_MAX_AUTO_WIDTH_WORLD stays on one line', () => {
    const text = 'a'.repeat(TEXT_MAX_AUTO_WIDTH_WORLD / 10);
    const box = layoutText(text, 'M', 'auto', null, fake);
    expect(box.lines).toEqual([text]);
    expect(box.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(box.height).toBeCloseTo(lineHeight('M'));
  });

  it('TC-10 fixed at TEXT_MIN_WIDTH_WORLD wraps three words one per line', () => {
    const box = layoutText('ab cd ef', 'M', 'fixed', TEXT_MIN_WIDTH_WORLD, fake);
    expect(box.width).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(box.lines.map((l) => l.trim())).toEqual(['ab', 'cd', 'ef']);
    expect(box.height).toBeCloseTo(3 * lineHeight('M'));
    // The same text in auto mode is one line.
    expect(layoutText('ab cd ef', 'M', 'auto', null, fake).lines).toHaveLength(1);
  });

  it('TC-11 explicit newlines: width is the longest line, height is line count × size × line height', () => {
    const box = layoutText('To improve\nCI\nOnboarding flow', 'L', 'auto', null, fake);
    expect(box.lines).toEqual(['To improve', 'CI', 'Onboarding flow']);
    expect(box.width).toBe(fake('Onboarding flow', TEXT_SIZES.L) + TEXT_CARET_SLACK_WORLD);
    expect(box.height).toBeCloseTo(3 * TEXT_SIZES.L * TEXT_LINE_HEIGHT);
    // A trailing newline is an empty last line.
    expect(layoutText('Heading\n', 'S', 'auto', null, fake).lines).toEqual(['Heading', '']);
  });

  it('a word wider than the box is broken across lines', () => {
    const box = layoutText('x'.repeat(10), 'M', 'fixed', 40, fake);
    expect(box.lines).toEqual(['xxxx', 'xxxx', 'xx']);
  });

  it('empty text is one line, at least TEXT_MIN_WIDTH_WORLD wide', () => {
    const box = layoutText('', 'XL', 'auto', null, fake);
    expect(box.width).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(box.height).toBeCloseTo(lineHeight('XL'));
  });
});

describe('text.layout measurer', () => {
  it('TC-32 without canvas the measurer falls back to a character-count estimate', () => {
    expect(typeof document).toBe('undefined');
    const measure = createCanvasMeasurer();
    expect(() => measure('Went well', TEXT_SIZES.M)).not.toThrow();
    expect(measure('Went well', TEXT_SIZES.M)).toBe(estimateMeasurer('Went well', TEXT_SIZES.M));
    expect(measure('Went well', TEXT_SIZES.M)).toBeGreaterThan(0);
    const box = layoutText('Went well', 'M', 'auto', null, measure);
    expect(box.width).toBeGreaterThan(TEXT_MIN_WIDTH_WORLD);
  });
});
