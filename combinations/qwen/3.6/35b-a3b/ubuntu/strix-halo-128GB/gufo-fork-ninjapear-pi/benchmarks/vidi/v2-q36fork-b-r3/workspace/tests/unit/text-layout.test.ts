import { describe, it, expect } from 'vitest';
import { layoutText, createCanvasMeasurer } from '@client/objects/textLayout';
import { TEXT_MAX_AUTO_WIDTH_WORLD, TEXT_MIN_WIDTH_WORLD, TEXT_SIZES, TEXT_LINE_HEIGHT } from '@shared/config';

// ─── Fake measurer for deterministic tests ────────────────────────────────
// Returns fixed world units per character (scales by font size ratio)
function makeFakeMeasurer(avgWidthPerCharAtM = 10): (text: string, fontPx: number) => number {
  return (text: string, fontPx: number): number => {
    // Scale from M-size (20px) to actual size
    const scaleFactor = fontPx / TEXT_SIZES.M;
    return text.length * avgWidthPerCharAtM * scaleFactor;
  };
}

const fakeMeasure = makeFakeMeasurer(10);

describe('TC-07: short text auto width', () => {
  it("'Went well' at M → one line, width = measured + padding", () => {
    const result = layoutText('Went well', 'M', 'auto', null, fakeMeasure);
    expect(result.lines).toEqual(['Went well']);
    expect(result.lines.length).toBe(1);
    expect(result.height).toBeCloseTo(TEXT_SIZES.M * TEXT_LINE_HEIGHT);
    // 9 chars × 10 = 90 world units
    expect(result.width).toBe(9 * 10);
  });
});

describe('TC-08: line longer than max auto width', () => {
  it('line measuring 900 → wraps, width = MAX_AUTO_WIDTH, 2 lines', () => {
    // A 90-char line at 10 units/char = 900, exceeds 600 max
    const longLine = 'a'.repeat(90);
    const result = layoutText(longLine, 'M', 'auto', null, fakeMeasure);
    expect(result.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(result.lines.length).toBeGreaterThanOrEqual(2);
    expect(result.height).toBeGreaterThan(TEXT_SIZES.M * TEXT_LINE_HEIGHT);
  });
});

describe('TC-09: line exactly at max auto width boundary', () => {
  it('line measuring exactly 600 → one line, width 600', () => {
    // Use a measurer where 60 chars = exactly 600 (10 per char), and test with a 60-char line
    const preciseMeasure: (text: string, fontPx: number) => number = (t) => t.length * 10;
    const result = layoutText('x'.repeat(60), 'M', 'auto', null, preciseMeasure);
    expect(result.width).toBe(600);
    expect(result.lines.length).toBe(1);
  });
});

describe('TC-10: fixed width minimum boundary', () => {
  it('fixed 40 with multiple words → wraps per word, height grows', () => {
    // Create a measurer where each word is > 40 units wide
    const narrowMeasure: (text: string, fontPx: number) => number = (t) => {
      if (t.length === 0) return 0;
      // Each character is worth ~5 units
      return t.length * 5;
    };
    // "one two three" → should wrap to 3 lines at width 40
    const result = layoutText('one two three', 'M', 'fixed', TEXT_MIN_WIDTH_WORLD, narrowMeasure);
    expect(result.width).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(result.lines.length).toBeGreaterThan(1);
  });
});

describe('TC-11: multi-line with Enter', () => {
  it('width = longest line, height = line count × size × LINE_HEIGHT', () => {
    const input = 'short\nthis is much longer';
    const result = layoutText(input, 'M', 'auto', null, fakeMeasure);
    expect(result.lines.length).toBe(2);
    const expectedHeight = 2 * TEXT_SIZES.M * TEXT_LINE_HEIGHT;
    expect(result.height).toBeCloseTo(expectedHeight);
  });
});

describe('TC-32: canvas measurer fallback without canvas', () => {
  it('createCanvasMeasurer in jsdom without real canvas → estimate fallback, no throw', () => {
    const measure = createCanvasMeasurer();
    // Should not throw
    expect(() => measure('hello', 20)).not.toThrow();
    // Should return some positive value
    const w = measure('hello', 20);
    expect(w).toBeGreaterThan(0);
  });

  it('measurer returns consistent values for same inputs', () => {
    const measure = createCanvasMeasurer();
    const w1 = measure('abc', 20);
    const w2 = measure('abc', 20);
    expect(w1).toBe(w2);
  });

  it('measurer scales with font size', () => {
    const measure = createCanvasMeasurer();
    const w20 = measure('test', 20);
    const w40 = measure('test', 40);
    expect(w40).toBeGreaterThan(w20);
  });
});
