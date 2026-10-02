import { describe, it, expect } from 'vitest';
import { layoutText, createCanvasMeasurer } from '../../src/client/objects/textLayout';
import type { Measurer } from '../../src/client/objects/textLayout';
import {
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
  TEXT_LINE_HEIGHT,
} from '../../src/shared/config';

/**
 * Fake measurer: each character occupies `charWidth = fontPx * 0.6` world units.
 * Deterministic for testing.
 */
function fakeMeasurer(text: string, fontPx: number): number {
  return text.length * fontPx * 0.6;
}

describe('text layout', () => {
  it('TC-07: "Went well" at M in auto mode → width = measured line, height one line', () => {
    const text = 'Went well'; // 9 chars
    const fontPx = TEXT_SIZES.M; // 20
    const expectedWidth = fakeMeasurer(text, fontPx); // 9 * 20 * 0.6 = 108
    const result = layoutText(text, 'M', 'auto', null, fakeMeasurer);

    expect(result.width).toBeCloseTo(expectedWidth, 1);
    expect(result.height).toBe(Math.round(1 * fontPx * TEXT_LINE_HEIGHT));
    expect(result.lines).toEqual(['Went well']);
  });

  it('TC-08: line measuring > TEXT_MAX_AUTO_WIDTH_WORLD → width TEXT_MAX_AUTO_WIDTH_WORLD, wraps to 2+ lines', () => {
    // Create a text long enough to exceed 600 units at M (20px):
    // Each char is 12 units. 600/12 = 50 chars max per line without wrapping.
    // 100 chars => width would be 1200 → exceeds 600, must wrap
    const text = 'word '.repeat(20).trim(); // ~100 chars with spaces
    const fontPx = TEXT_SIZES.M; // 20
    const fullWidth = fakeMeasurer(text, fontPx); // ~100*12=1200 > 600
    expect(fullWidth).toBeGreaterThan(TEXT_MAX_AUTO_WIDTH_WORLD);

    const result = layoutText(text, 'M', 'auto', null, fakeMeasurer);
    expect(result.width).toBeLessThanOrEqual(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(result.lines.length).toBeGreaterThan(1);
    expect(result.height).toBe(Math.round(result.lines.length * fontPx * TEXT_LINE_HEIGHT));
  });

  it('TC-09: line measuring exactly TEXT_MAX_AUTO_WIDTH_WORLD → one line, width = TEXT_MAX_AUTO_WIDTH_WORLD', () => {
    // At M (20px), charWidth = 12. 600/12 = 50 chars exactly.
    const text = 'a'.repeat(50);
    const fontPx = TEXT_SIZES.M; // 20
    const lineWidth = fakeMeasurer(text, fontPx); // 50*12=600 = TEXT_MAX_AUTO_WIDTH_WORLD
    expect(lineWidth).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);

    const result = layoutText(text, 'M', 'auto', null, fakeMeasurer);
    expect(result.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(result.lines).toEqual([text]);
    expect(result.height).toBe(Math.round(1 * fontPx * TEXT_LINE_HEIGHT));
  });

  it('TC-10: fixed width TEXT_MIN_WIDTH_WORLD with three words → one word per line, height 3 lines', () => {
    // At M (20px), charWidth=12. TEXT_MIN_WIDTH_WORLD=40.
    // Each word must be > 40/12 ≈ 3.3 chars to not fit two words on one line.
    // "abc" = 3 chars = 36 < 40, but "abc def" = 7 chars = 84 > 40.
    // Let's use words of 4 chars: "word word word". "word" = 48 > 40, so "word word" = 108 > 40 → one word per line.
    const text = 'word word word';
    const fontPx = TEXT_SIZES.M; // 20
    // charWidth=12, word=48, space between = 12
    // "word w" would be 96 > 40, so each "word" wraps individually

    const result = layoutText(text, 'M', 'fixed', TEXT_MIN_WIDTH_WORLD, fakeMeasurer);
    // Each word "word" is 4*12=48 > 40, so greedy wrap: first "word" doesn't fit?
    // Actually greedy: start with "", test "word" = 48 > 40, so we put "word" alone
    // then "word" = 48 > 40, alone, then "word" = 48 > 40, alone
    // So 3 lines
    expect(result.lines.length).toBe(3);
    expect(result.width).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(result.height).toBe(Math.round(3 * fontPx * TEXT_LINE_HEIGHT));
  });

  it('TC-11: text with explicit newlines → width = longest line, height = line count × size × TEXT_LINE_HEIGHT', () => {
    const text = 'hi\nhello world\nhey';
    const fontPx = TEXT_SIZES.M; // 20
    const result = layoutText(text, 'M', 'auto', null, fakeMeasurer);

    const longestLine = 'hello world'; // 11 chars = 132
    expect(result.width).toBeCloseTo(fakeMeasurer(longestLine, fontPx), 1);
    expect(result.lines.length).toBe(3);
    expect(result.height).toBe(Math.round(3 * fontPx * TEXT_LINE_HEIGHT));
  });

  it('TC-32: createCanvasMeasurer in environment without canvas → estimate fallback, no throw', () => {
    // In node/jsdom, OffscreenCanvas may not exist and document.createElement('canvas')
    // may not return a usable context. The function should still return a working measurer.
    const measurer = createCanvasMeasurer();
    expect(typeof measurer).toBe('function');
    // Should return a positive number without throwing
    const width = measurer('hello', 20);
    expect(width).toBeGreaterThan(0);
    expect(Number.isFinite(width)).toBe(true);
  });

  it('empty text → width 0, height one line', () => {
    const result = layoutText('', 'M', 'auto', null, fakeMeasurer);
    expect(result.width).toBe(0);
    expect(result.height).toBe(Math.round(TEXT_SIZES.M * TEXT_LINE_HEIGHT));
  });

  it('fixed mode with width larger than text → text fits on one line', () => {
    const result = layoutText('hi', 'M', 'fixed', 500, fakeMeasurer);
    expect(result.width).toBe(500);
    expect(result.lines.length).toBe(1);
  });
});
