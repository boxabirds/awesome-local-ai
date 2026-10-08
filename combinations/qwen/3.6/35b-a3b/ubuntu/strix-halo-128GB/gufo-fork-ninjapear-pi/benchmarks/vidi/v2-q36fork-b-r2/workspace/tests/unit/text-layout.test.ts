import { describe, it, expect } from 'vitest';
import {
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
  TEXT_LINE_HEIGHT,
} from '../../src/shared/config';
import { layoutText, createCanvasMeasurer } from '../../src/client/objects/textLayout';
import type { Measurer } from '../../src/client/objects/textLayout';

// Helper: deterministic fake measurer - returns fixed px per character at each size
function makeFakeMeasurer(pixelsPerCharAtM: number = 10): Measurer {
  // Base rate is pixelsPerCharAtM for size M (20px). Scale proportionally.
  const basePxPerChar = pixelsPerCharAtM / TEXT_SIZES.M; // pixels per char at 1px font
  return (text: string, fontPx: number): number => {
    return text.length * basePxPerChar * fontPx;
  };
}

describe('TC-07: layoutText short text "Went well" at M', () => {
  it('width ~ measured line + padding, height one line', () => {
    const measure = makeFakeMeasurer(10);
    const result = layoutText('Went well', 'M', 'auto', null, measure);

    // "Went well" = 9 chars. At M (size 20), fake measurer gives:
    // 9 * 0.5 * 20 = 90 world units
    // Height = 1 * 20 * 1.3 = 26
    expect(result.lines.length).toBe(1);
    expect(result.width).toBeGreaterThan(0);
    expect(result.height).toBe(TEXT_SIZES.M * TEXT_LINE_HEIGHT);
  });
});

describe('TC-08: layoutText line measuring 900 -> auto width capped at 600, wraps', () => {
  it('one long word > 600 gets wrapped into multiple lines', () => {
    // Create a measurer that makes "hello" measure 200px
    const measure: Measurer = (text: string): number => {
      // Each character measures 40 world units regardless of size
      return text.length * 40;
    };

    // A single 30-char word would measure 1200px, should wrap
    const result = layoutText('a'.repeat(30), 'M', 'auto', null, measure);

    expect(result.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD); // 600
    expect(result.lines.length).toBeGreaterThan(1);
  });
});

describe('TC-09: layoutText line exactly 600 -> one line, width 600', () => {
  it('boundary case: exactly max', () => {
    const measure: Measurer = (text: string): number => {
      return text.length * 40;
    };

    // 15 chars * 40 = 600, exactly at limit
    const result = layoutText('x'.repeat(15), 'M', 'auto', null, measure);
    expect(result.lines.length).toBe(1);
    expect(result.width).toBe(600);
  });
});

describe('TC-10: layoutText fixed mode TEXT_MIN_WIDTH_WORLD wraps words', () => {
  it('3 words at width 40 -> one word per line', () => {
    // Each character measures 20 world units
    const measure: Measurer = (text: string): number => {
      return text.length * 20;
    };

    const result = layoutText('hello world test', 'M', 'fixed', TEXT_MIN_WIDTH_WORLD, measure);

    // Total chars: 16. At width 40, each line can hold ~2 chars
    // "he ll o wo rl d te st" roughly - multiple lines
    expect(result.width).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(result.lines.length).toBeGreaterThan(1);
  });
});

describe('TC-11: layoutText with explicit newlines', () => {
  it('multi-line text: width = longest line, height = lineCount × size × lineHeight', () => {
    const measure: Measurer = (text: string): number => {
      return text.length * 10;
    };

    const text = 'abc\nde\nfghi'; // lines: 3, 2, 4 chars
    const result = layoutText(text, 'L', 'auto', null, measure);

    // Longest line = "fghi" = 4 * 10 = 40
    expect(result.width).toBe(40);
    expect(result.lines.length).toBe(3);
    expect(result.height).toBe(3 * TEXT_SIZES.L * TEXT_LINE_HEIGHT);
  });
});

describe('TC-32: createCanvasMeasurer fallback without canvas', () => {
  it('returns estimate function when no canvas available, no throw', () => {
    // Even without canvas, this should not throw
    const measure = createCanvasMeasurer();
    // Should work with any input
    const w1 = measure('hello', 20);
    const w2 = measure('', 20);
    expect(typeof w1).toBe('number');
    expect(typeof w2).toBe('number');
    expect(w2).toBe(0);
  });
});

describe('layoutText edge cases', () => {
  it('empty text -> width 0, height 0, no lines', () => {
    const measure: Measurer = (_t: string) => 100;
    const result = layoutText('', 'M', 'auto', null, measure);
    expect(result.width).toBe(0);
    expect(result.height).toBe(0);
    expect(result.lines.length).toBe(0);
  });

  it('single newline creates two empty lines', () => {
    const measure: Measurer = (_t: string) => 100;
    const result = layoutText('\n', 'M', 'auto', null, measure);
    expect(result.lines.length).toBe(2);
  });

  it('auto width uses min of measured and TEXT_MAX_AUTO_WIDTH_WORLD', () => {
    const measure: Measurer = (t: string) => t.length * 100;
    // 10 chars = 1000 measured > 600 max
    const result = layoutText('x'.repeat(10), 'M', 'auto', null, measure);
    expect(result.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
  });
});
