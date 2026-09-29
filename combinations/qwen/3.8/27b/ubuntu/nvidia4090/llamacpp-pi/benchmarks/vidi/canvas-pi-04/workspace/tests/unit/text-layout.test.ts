// Story 9, task 3: unit tests for the pure text layout (TC-07..TC-11, TC-32).
//
// The layout is a pure function of (text, size, mode, fixed width, measurer),
// so it is tested with a deterministic fake measurer: every character is
// 0.5 * fontPx wide (10 world units per character at size M = 20).

import { describe, expect, it } from 'vitest';
import {
  createCanvasMeasurer,
  layoutText,
  type Measurer,
} from '../../src/client/objects/textLayout';
import {
  TEXT_LINE_HEIGHT,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
} from '../../src/shared/config';

/** Deterministic fake: each character is 0.5 * fontPx wide. */
const fake: Measurer = (text, fontPx) => text.length * fontPx * 0.5;

describe('layoutText: auto width (TC-07, TC-08, TC-09)', () => {
  it('TC-07 short line: box is exactly the measured line, height is one line', () => {
    // 'Went well' = 9 chars * 10 = 90 world units at M (20px).
    const layout = layoutText('Went well', 'M', 'auto', null, fake);
    expect(layout.width).toBe(90);
    expect(layout.height).toBe(TEXT_SIZES.M * TEXT_LINE_HEIGHT); // 26
    expect(layout.lines).toEqual(['Went well']);
  });

  it('TC-08 long line (measured 900 > 600): wraps at 600 into two lines', () => {
    // 90 chars * 10 = 900 measured. Words: 45 + space + 44.
    const text = 'a'.repeat(45) + ' ' + 'b'.repeat(44);
    expect(text.length * 10).toBe(900);
    const layout = layoutText(text, 'M', 'auto', null, fake);
    expect(layout.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD); // 600, clamped
    expect(layout.lines).toHaveLength(2);
    expect(layout.height).toBe(2 * TEXT_SIZES.M * TEXT_LINE_HEIGHT); // 52
  });

  it('TC-09 boundary: a line measured EXACTLY 600 stays one line at width 600', () => {
    // 60 chars * 10 = 600 — at the limit, NOT over it.
    const text = 'a'.repeat(60);
    const layout = layoutText(text, 'M', 'auto', null, fake);
    expect(layout.width).toBe(600);
    expect(layout.lines).toHaveLength(1);
    expect(layout.height).toBe(TEXT_SIZES.M * TEXT_LINE_HEIGHT);
  });
});

describe('layoutText: fixed width (TC-10)', () => {
  it('TC-10 fixed 40 with 3 short words: one word per line, height 3 lines', () => {
    // Each word is 3 chars = 30 <= 40; two words + space = 70 > 40.
    const layout = layoutText('aaa bbb ccc', 'M', 'fixed', 40, fake);
    expect(layout.width).toBe(40);
    expect(layout.lines).toEqual(['aaa', 'bbb', 'ccc']);
    expect(layout.height).toBe(3 * TEXT_SIZES.M * TEXT_LINE_HEIGHT); // 78
  });

  it('fixed width clamps at the minimum (TEXT_MIN_WIDTH_WORLD)', () => {
    const layout = layoutText('aaa bbb ccc', 'M', 'fixed', 5, fake);
    expect(layout.width).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(layout.lines).toHaveLength(3);
  });

  it('fixed width wraps at that width regardless of the content width', () => {
    // 6 words of 3 chars; at fixed 100 each line fits 3 words (30+10+30+10+30 = 110 > 100?
    // 'aaa bbb ccc' = 11 chars = 110 > 100, so two words per line: 'aaa bbb' = 70).
    const text = 'aaa bbb ccc ddd eee fff';
    const layout = layoutText(text, 'M', 'fixed', 100, fake);
    expect(layout.width).toBe(100);
    expect(layout.lines).toEqual(['aaa bbb', 'ccc ddd', 'eee fff']);
    expect(layout.height).toBe(3 * TEXT_SIZES.M * TEXT_LINE_HEIGHT);
  });
});

describe('layoutText: explicit newlines (TC-11)', () => {
  it('TC-11 newlines break lines and the box is the longest line', () => {
    // 'Went well' = 90, 'to improve' = 100 (10 chars) -> width 100, 2 lines.
    const layout = layoutText('Went well\nto improve', 'M', 'auto', null, fake);
    expect(layout.width).toBe(100);
    expect(layout.lines).toHaveLength(2);
    expect(layout.height).toBe(2 * TEXT_SIZES.M * TEXT_LINE_HEIGHT);
  });

  it('a long second line still clamps the box to the max auto width', () => {
    // 15 words of 5 chars (each 50u, space 10u): line 1 fits 10 words
    // (10*50 + 9*10 = 590 <= 600), line 2 the remaining 5.
    const words = Array.from({ length: 15 }, () => 'a'.repeat(5)).join(' ');
    expect(words.length * 10).toBe(15 * 50 + 14 * 10); // 890 measured
    const layout = layoutText(`ok\n${words}`, 'M', 'auto', null, fake);
    expect(layout.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(layout.lines).toHaveLength(3); // 'ok' + the 15 words wrapped into two
  });
});

describe('layoutText: sizes and edge cases', () => {
  it('scales with the size preset (L has the same line count, larger box)', () => {
    const m = layoutText('Went well', 'M', 'auto', null, fake);
    const l = layoutText('Went well', 'L', 'auto', null, fake);
    expect(l.width).toBe((TEXT_SIZES.L / TEXT_SIZES.M) * m.width);
    expect(l.height).toBe((TEXT_SIZES.L / TEXT_SIZES.M) * m.height);
  });

  it('empty text: one line, the minimum clickable width', () => {
    const layout = layoutText('', 'M', 'auto', null, fake);
    expect(layout.width).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(layout.lines).toEqual(['']);
    expect(layout.height).toBe(TEXT_SIZES.M * TEXT_LINE_HEIGHT);
  });

  it('a single word wider than the fixed width overflows on its own line', () => {
    // 40 chars = 400 > fixed 100; it cannot be split mid-word.
    const layout = layoutText('a'.repeat(40), 'M', 'fixed', 100, fake);
    expect(layout.lines).toEqual(['a'.repeat(40)]);
    expect(layout.width).toBe(100);
  });

  it('consecutive spaces are preserved inside a line', () => {
    const layout = layoutText('a  b', 'M', 'fixed', 100, fake);
    expect(layout.lines).toEqual(['a  b']);
  });
});

describe('createCanvasMeasurer (TC-32)', () => {
  it('never throws without a canvas (jsdom/node) and estimates width', () => {
    const measure = createCanvasMeasurer();
    expect(() => measure('abc', 20)).not.toThrow();
    const w = measure('abc', 20);
    expect(w).toBeGreaterThan(0);
    // Longer text measures wider (monotonic in the estimate).
    expect(measure('abcdefgh', 20)).toBeGreaterThan(w);
    // Bigger font measures wider.
    expect(measure('abc', 40)).toBeGreaterThan(w);
  });
});
