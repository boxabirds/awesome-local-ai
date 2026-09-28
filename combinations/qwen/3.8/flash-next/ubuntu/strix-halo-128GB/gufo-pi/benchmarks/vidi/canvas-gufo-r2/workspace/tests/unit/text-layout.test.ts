/**
 * Unit tests for text layout (TC-07 to TC-11, TC-32).
 * Uses a fake measurer: fixed world-units-per-character at each TEXT_SIZES value.
 */
import { describe, it, expect } from 'vitest';
import {
  layoutText,
  createCanvasMeasurer,
  type Measurer,
} from '../../src/client/objects/textLayout';
import {
  TEXT_SIZES,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_MIN_WIDTH_WORLD,
} from '../../src/shared/config';

/**
 * Fake measurer: each character is `px` world-units wide.
 * Width = text.length * px
 */
function fakeMeasurer(px: number): Measurer {
  return (text: string, _fontPx: number) => text.length * px;
}

describe('text layout', () => {
  // TC-07: 'Went well' at M in auto mode → width = measured line + padding, height one line.
  // Using a fake measurer where each char is 10 units wide:
  // 'Went well' is 9 chars → 90 units wide at any size. Since 90 < 600, auto width = 90.
  it('TC-07: short text in auto mode', () => {
    const measure = fakeMeasurer(10);
    const result = layoutText('Went well', 'M', 'auto', null, measure);
    // width = 90 (the line measurement), height = 1 line
    expect(result.width).toBe(90);
    expect(result.height).toBe(TEXT_SIZES.M * TEXT_LINE_HEIGHT);
    expect(result.lines).toEqual(['Went well']);
  });

  // TC-08: line measuring 900 → width TEXT_MAX_AUTO_WIDTH_WORLD, greedy word wrap into 2 lines, height 2 lines.
  // Use a measurer where each char is 10 units: a 90-char string → 900 units.
  it('TC-08: line exceeding max auto width wraps', () => {
    // 90 chars of 'a' with a space in the middle to allow wrapping
    const text = 'a'.repeat(45) + ' ' + 'a'.repeat(44); // 90 chars total
    const measure = fakeMeasurer(10); // 900 units total
    const result = layoutText(text, 'M', 'auto', null, measure);
    expect(result.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(result.lines.length).toBeGreaterThanOrEqual(2);
    expect(result.height).toBe(result.lines.length * TEXT_SIZES.M * TEXT_LINE_HEIGHT);
  });

  // TC-09: line measuring exactly 600 → one line, width 600 (boundary).
  it('TC-09: line exactly at max auto width', () => {
    // 60 chars at 10 units each = 600 exactly
    const text = 'a'.repeat(60);
    const measure = fakeMeasurer(10);
    const result = layoutText(text, 'M', 'auto', null, measure);
    expect(result.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(result.lines.length).toBe(1);
    expect(result.height).toBe(TEXT_SIZES.M * TEXT_LINE_HEIGHT);
  });

  // TC-10: fixed width TEXT_MIN_WIDTH_WORLD with three words → one word per line, height 3 lines.
  it('TC-10: fixed width forces word wrap', () => {
    // Each word 5 chars, each char is 10 units → each word is 50 units
    // Fixed width = 40 (TEXT_MIN_WIDTH_WORLD), so only one word per line (50 > 40/2=20 per word)
    // Wait, if each word is 50 units and width is 40, even one word doesn't fit...
    // Let me use smaller chars: 3 chars per word at 10 units = 30 units per word, space = 10 units
    // 'abc def ghi' = 3+1+3+1+3 = 11 chars → each word is 30 units
    // At fixed width 40: 'abc' (30) fits, 'abc def' (70) doesn't → each word on own line
    const text = 'abc def ghi';
    const measure = fakeMeasurer(10);
    const result = layoutText(text, 'M', 'fixed', TEXT_MIN_WIDTH_WORLD, measure);
    expect(result.width).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(result.lines).toEqual(['abc', 'def', 'ghi']);
    expect(result.height).toBe(3 * TEXT_SIZES.M * TEXT_LINE_HEIGHT);
  });

  // TC-11: text with explicit newlines → width = longest line, height = line count × size × TEXT_LINE_HEIGHT.
  it('TC-11: multi-line text with explicit newlines', () => {
    const text = 'Hi\nHello World\nBye';
    const measure = fakeMeasurer(10);
    const result = layoutText(text, 'L', 'auto', null, measure);
    // Lines: 'Hi' (20), 'Hello World' (110), 'Bye' (30)
    // Longest = 110, all < 600 so auto width = 110
    expect(result.width).toBe(110);
    expect(result.lines).toEqual(['Hi', 'Hello World', 'Bye']);
    expect(result.height).toBe(3 * TEXT_SIZES.L * TEXT_LINE_HEIGHT);
  });

  // TC-32: createCanvasMeasurer in an environment without canvas → estimate fallback, no throw.
  it('TC-32: createCanvasMeasurer falls back to estimate without canvas', () => {
    // In node environment, no canvas is available
    const measure = createCanvasMeasurer('Arial');
    // Should not throw
    const width = measure('hello', 20);
    expect(typeof width).toBe('number');
    expect(width).toBeGreaterThan(0);
    // Estimate should be roughly proportional to text length and font size
    const width2 = measure('hello world', 20);
    expect(width2).toBeGreaterThan(width);
  });
});
