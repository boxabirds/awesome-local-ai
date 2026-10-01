import { describe, expect, it } from 'vitest';
import {
  TEXT_CARET_ROOM_WORLD,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
} from '../../src/shared/config';
import { createCanvasMeasurer, layoutText } from '../../src/client/objects/textLayout';

/** 10 world units per character, whatever the font size. */
const fake = (text: string) => text.length * 10;
const LINE = TEXT_SIZES.M * TEXT_LINE_HEIGHT;

describe('layoutText', () => {
  it('TC-07 short text is one line, just wider than the words', () => {
    const r = layoutText('Went well', 'M', 'auto', null, fake);
    expect(r.width).toBe(90 + TEXT_CARET_ROOM_WORLD);
    expect(r.height).toBe(LINE);
    expect(r.lines).toEqual(['Went well']);
  });

  it('TC-08 a 900 wide line wraps at the maximum auto width', () => {
    const text = Array.from({ length: 15 }, () => 'abcdefgh').join(' '); // 15 * 8 + 14 = 134 chars
    const r = layoutText(text.slice(0, 89), 'M', 'auto', null, fake);
    expect(r.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(r.lines).toHaveLength(2);
    expect(r.height).toBe(2 * LINE);
    r.lines.forEach((l) => expect(fake(l.trimEnd())).toBeLessThanOrEqual(TEXT_MAX_AUTO_WIDTH_WORLD));
  });

  it('TC-09 a line of exactly the maximum width stays on one line', () => {
    const r = layoutText('x'.repeat(60), 'M', 'auto', null, fake);
    expect(r.lines).toHaveLength(1);
    expect(r.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
  });

  it('TC-10 minimum fixed width wraps one word per line', () => {
    const r = layoutText('aaa bbb ccc', 'M', 'fixed', TEXT_MIN_WIDTH_WORLD, fake);
    expect(r.lines.map((l) => l.trim())).toEqual(['aaa', 'bbb', 'ccc']);
    expect(r.width).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(r.height).toBe(3 * LINE);
  });

  it('TC-11 explicit newlines: width is the longest line, height counts lines', () => {
    const r = layoutText('ab\nabcde\n\nabc', 'L', 'auto', null, fake);
    expect(r.width).toBe(50 + TEXT_CARET_ROOM_WORLD);
    expect(r.lines).toHaveLength(4);
    expect(r.height).toBe(4 * TEXT_SIZES.L * TEXT_LINE_HEIGHT);
  });

  it('breaks a single over-long word by character', () => {
    const r = layoutText('x'.repeat(25), 'M', 'fixed', 100, fake);
    expect(r.lines.map((l) => l.length)).toEqual([10, 10, 5]);
  });

  it('TC-32 the canvas measurer falls back to an estimate without a canvas', () => {
    const measure = createCanvasMeasurer();
    expect(() => measure('hello', 20)).not.toThrow();
    expect(measure('hello', 20)).toBeGreaterThan(0);
    expect(measure('', 20)).toBe(0);
  });
});
