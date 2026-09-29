/**
 * Unit tests for text layout (story 9, TC-07 to TC-11, TC-32).
 *
 * Uses a deterministic fake measurer: `text.length × fontPx / 2`.
 * No DOM required.
 */

import { describe, it, expect } from 'vitest';
import {
  layoutText,
  createFallbackMeasurer,
  type Measurer,
} from '../../src/client/objects/textLayout';
import { TEXT_MAX_AUTO_WIDTH_WORLD, TEXT_MIN_WIDTH_WORLD, TEXT_LINE_HEIGHT, TEXT_SIZES } from '../../src/shared/config';

/** Fake measurer: each character is fontPx/2 world units wide. */
const fakeMeasurer: Measurer = (text: string, fontPx: number) =>
  text.length * (fontPx / 2);

const M = TEXT_SIZES.M; // 20

describe('text.layout (story 9)', () => {
  // TC-07: short line → width = measured line, height = one line.
  it('TC-07 short line: width = measured, height = 1 line', () => {
    const result = layoutText('Went well', {
      measurer: fakeMeasurer,
      size: 'M',
      widthMode: 'auto',
      width: 0,
    });
    // 'Went well' = 9 chars × 10 = 90
    expect(result.width).toBe(90);
    expect(result.height).toBe(M * TEXT_LINE_HEIGHT);
    expect(result.lines).toEqual(['Went well']);
  });

  // TC-08: line wider than max auto → width = max auto, wraps to 2 lines.
  it('TC-08 line 900 wide: width clamped to 600, wraps to 2 lines', () => {
    // 9 words of 10 chars each, separated by spaces: 98 chars × 10 = 980px
    const text = 'abcdefghij abcdefghij abcdefghij abcdefghij abcdefghij abcdefghij abcdefghij abcdefghij abcdefghij';
    const result = layoutText(text, {
      measurer: fakeMeasurer,
      size: 'M',
      widthMode: 'auto',
      width: 0,
    });
    expect(result.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD); // 600
    expect(result.lines.length).toBe(2);
    expect(result.height).toBe(2 * M * TEXT_LINE_HEIGHT);
  });

  // TC-09: line exactly at max → one line, width = max.
  it('TC-09 line exactly 600: one line, width 600', () => {
    // 60 chars × 10 = 600
    const text = 'a'.repeat(60);
    const result = layoutText(text, {
      measurer: fakeMeasurer,
      size: 'M',
      widthMode: 'auto',
      width: 0,
    });
    expect(result.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(result.lines).toEqual([text]);
    expect(result.height).toBe(M * TEXT_LINE_HEIGHT);
  });

  // TC-10: fixed width 40 with 3 words → wraps; height grows.
  it('TC-10 fixed 40: wraps per word, height grows', () => {
    const result = layoutText('a b c', {
      measurer: fakeMeasurer,
      size: 'M',
      widthMode: 'fixed',
      width: TEXT_MIN_WIDTH_WORLD, // 40
    });
    expect(result.width).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(result.lines.length).toBeGreaterThanOrEqual(2);
    expect(result.height).toBe(result.lines.length * M * TEXT_LINE_HEIGHT);
  });

  // TC-11: multi-line with Enter → width = longest line; height = lines × lineHeight.
  it('TC-11 multi-line: width = longest line, height = lines × lineHeight', () => {
    const text = 'short\na much longer line here\nmid';
    const result = layoutText(text, {
      measurer: fakeMeasurer,
      size: 'M',
      widthMode: 'auto',
      width: 0,
    });
    // 'a much longer line here' = 23 chars × 10 = 230 (longest)
    expect(result.width).toBe(230);
    expect(result.lines.length).toBe(3);
    expect(result.height).toBe(3 * M * TEXT_LINE_HEIGHT);
  });

  // TC-32: fallback measurer (no canvas) → no throw, reasonable estimate.
  it('TC-32 fallback measurer: no throw, deterministic estimate', () => {
    const fallback = createFallbackMeasurer();
    const result = layoutText('Hello world', {
      measurer: fallback,
      size: 'M',
      widthMode: 'auto',
      width: 0,
    });
    expect(result.width).toBeGreaterThan(0);
    expect(result.height).toBeGreaterThan(0);
    expect(result.lines.length).toBeGreaterThan(0);
  });

  // Empty text → zero width and height.
  it('empty text: zero width and height', () => {
    const result = layoutText('', {
      measurer: fakeMeasurer,
      size: 'M',
      widthMode: 'auto',
      width: 0,
    });
    expect(result.width).toBe(0);
    expect(result.height).toBe(0);
    expect(result.lines).toEqual(['']);
  });
});
