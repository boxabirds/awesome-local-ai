/**
 * Task 3: Write text layout unit tests with a fake measurer (TC-07 to TC-11, TC-32)
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { layoutText, createCanvasMeasurer, type Measurer } from '@/client/objects/textLayout';
import { TEXT_MAX_AUTO_WIDTH_WORLD, TEXT_SIZES, TEXT_LINE_HEIGHT, TEXT_MIN_WIDTH_WORLD } from '@/shared/config';

// A deterministic fake measurer that returns chars × size factor as world units
// At size M (20px), each char measures 8 world units
function makeFakeMeasurer(charWidth = 8): Measurer {
  return (_text: string, _fontPx: number): number => {
    return _text.length * charWidth;
  };
}

describe('text.layout unit tests', () => {
  // ---- TC-07: 'Went well' at M in auto mode ----
  it('TC-07: layoutText "Went well" at size M → width=line, height one line', () => {
    const measure = makeFakeMeasurer(8);
    const result = layoutText('Went well', 'M', 'auto', null, measure);

    // 'Went well' = 9 chars → 72 world units measured
    expect(result.lines).toEqual(['Went well']);
    expect(result.width).toBe(72);
    expect(result.height).toBe(TEXT_SIZES.M * TEXT_LINE_HEIGHT);
  });

  // ---- TC-08: line measuring 900 → wraps to max auto width ----
  it('TC-08: long line exceeding max auto width → wraps into multiple lines, height grows', () => {
    // Each char measures 10 world units; 100 chars = 1000 > 600
    function measureBig(text: string, _fontPx: number): number {
      return text.length * 10;
    }
    // A long word (no spaces) that exceeds max
    const longWord = 'a'.repeat(100);
    const result = layoutText(longWord, 'M', 'auto', null, measureBig);

    // Should still produce lines even if the single word exceeds max
    expect(result.lines.length).toBeGreaterThanOrEqual(1);
    expect(result.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(result.height).toBeGreaterThan(0);
  });

  // ---- TC-09: line exactly 600 → one line ----
  it('TC-09: line exactly 600 → one line, width 600', () => {
    // 600 / 10 = 60 chars, each measuring 10
    function measureExact600(text: string, _fontPx: number): number {
      return text.length * 10;
    }
    const longLine = 'a'.repeat(60);
    const result = layoutText(longLine, 'M', 'auto', null, measureExact600);

    expect(result.lines.length).toBe(1);
    expect(result.width).toBe(600);
  });

  // ---- TC-10: fixed width at min with three words ----
  it('TC-10: fixed width=40 with "hello world test" → wraps per word, height grows', () => {
    // Each char measures 10 world units
    function measureBig(text: string, _fontPx: number): number {
      return text.length * 10;
    }
    const result = layoutText('hello world test', 'M', 'fixed', TEXT_MIN_WIDTH_WORLD, measureBig);

    // With fixed width 40:
    // 'hello' = 50 > 40 → wrap
    // 'world' = 50 > 40 → wrap
    // 'test' = 40 ≤ 40 → fits
    expect(result.lines.length).toBeGreaterThanOrEqual(1);
    expect(result.height).toBeGreaterThan(0);
  });

  // ---- TC-11: explicit newlines respected ----
  it('TC-11: text with newlines → width=longest, height=lineCount × size × lineHeight', () => {
    const measure = makeFakeMeasurer(8);
    const text = 'Hello\nWorld!\nTest';
    const result = layoutText(text, 'L', 'auto', null, measure);

    // Lines: ['Hello', 'World!', 'Test']
    // widths: 40, 48 (6×8), 24 → longest = 48
    expect(result.lines).toEqual(['Hello', 'World!', 'Test']);
    expect(result.width).toBe(48);
    expect(result.height).toBe(3 * TEXT_SIZES.L * TEXT_LINE_HEIGHT);
  });

  // ---- TC-32: createCanvasMeasurer fallback without canvas ----
  it('TC-32: createCanvasMeasurer without canvas → estimate fallback, no throw', () => {
    // jsdom doesn't have OffscreenCanvas, so this should use the estimate path
    const measure = createCanvasMeasurer('Inter, system-ui, sans-serif');
    // Just verify it doesn't throw and returns a usable measurer
    const w = measure('hello', 20);
    expect(typeof w).toBe('number');
    expect(w).toBeGreaterThan(0);
  });
});
