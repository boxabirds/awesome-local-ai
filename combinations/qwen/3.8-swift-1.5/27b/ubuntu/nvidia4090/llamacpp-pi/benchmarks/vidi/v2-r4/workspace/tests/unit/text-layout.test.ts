import { describe, it, expect } from 'vitest';
import { layoutText, createCanvasMeasurer, type Measurer } from '../../src/client/objects/textLayout';
import {
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
  TEXT_LINE_HEIGHT,
  TEXT_PADDING_WORLD,
} from '../../src/shared/config';

// Deterministic fake measurer: 10 world units per character (fixed px per
// character, per the design's mock boundary).
const PX_PER_CHAR = 10;
const fake: Measurer = (text) => text.length * PX_PER_CHAR;

describe('text.layout unit tests', () => {
  // TC-07: 'Went well' measured 90 at M → width 90 + padding, height one line
  it('TC-07: short single line → width = measured + padding, height one line', () => {
    const text = 'Went well'; // 9 chars → 90 world units
    const { width, height, lines } = layoutText(text, 'M', 'auto', null, fake);

    expect(lines).toEqual([text]);
    expect(height).toBe(TEXT_SIZES.M * TEXT_LINE_HEIGHT);
    expect(width).toBe(text.length * PX_PER_CHAR + TEXT_PADDING_WORLD);
  });

  // TC-08: line 900 wide → width TEXT_MAX_AUTO_WIDTH_WORLD, wraps to 2 lines
  it('TC-08: over-wide line wraps and width caps at TEXT_MAX_AUTO_WIDTH_WORLD', () => {
    // 90 chars × 10 = 900 world units; cap is 600 → 60 chars per line
    const text = 'a'.repeat(90);
    const { width, height, lines } = layoutText(text, 'M', 'auto', null, fake);

    expect(width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(lines).toHaveLength(2);
    expect(lines[0].length).toBe(60);
    expect(lines[1].length).toBe(30);
    expect(height).toBe(2 * TEXT_SIZES.M * TEXT_LINE_HEIGHT);
  });

  // TC-09: line exactly 600 → one line, width 600 (boundary)
  it('TC-09: line exactly at the cap stays one line with width = cap', () => {
    const text = 'a'.repeat(60); // 60 × 10 = 600 = cap
    const { width, height, lines } = layoutText(text, 'M', 'auto', null, fake);

    expect(lines).toHaveLength(1);
    expect(width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(height).toBe(TEXT_SIZES.M * TEXT_LINE_HEIGHT);
  });

  // TC-10: fixed 40 with 3 words → wraps per word; height grows
  it('TC-10: fixed narrow width wraps per word and grows height', () => {
    // fixed width 40 → 4 chars per line; 3 words of 2 chars each
    const text = 'ab cd ef';
    const { width, height, lines } = layoutText(text, 'M', 'fixed', TEXT_MIN_WIDTH_WORLD, fake);

    expect(width).toBe(TEXT_MIN_WIDTH_WORLD);
    // Each word (2 chars = 20) fits, two words + space (5 chars = 50) does not
    expect(lines).toHaveLength(3);
    expect(height).toBe(3 * TEXT_SIZES.M * TEXT_LINE_HEIGHT);
  });

  // TC-11: multi-line with Enter → width = longest line; height = lines × size × LINE_HEIGHT
  it('TC-11: explicit newlines → width longest line, height = lines × size × line height', () => {
    const text = 'short\na much longer line here\nmid';
    const { width, height, lines } = layoutText(text, 'L', 'auto', null, fake);

    expect(lines).toEqual(['short', 'a much longer line here', 'mid']);
    expect(height).toBe(3 * TEXT_SIZES.L * TEXT_LINE_HEIGHT);
    // longest line = 'a much longer line here' (23 chars = 230)
    expect(width).toBe(23 * PX_PER_CHAR + TEXT_PADDING_WORLD);
  });

  // Empty text → 0 × 0
  it('empty text measures to a zero box', () => {
    const { width, height, lines } = layoutText('', 'M', 'auto', null, fake);
    expect(width).toBe(0);
    expect(height).toBe(0);
    expect(lines).toEqual([]);
  });

  // TC-32: jsdom without canvas → createCanvasMeasurer uses the estimate, no throw
  it('TC-32: createCanvasMeasurer falls back to an estimate without a canvas', () => {
    const measure = createCanvasMeasurer();
    expect(() => measure('hello', 20)).not.toThrow();
    // The estimate is a positive, deterministic number
    const w = measure('hello', 20);
    expect(w).toBeGreaterThan(0);
    expect(w).toBe(measure('hello', 20));
    // and it scales with the font size
    expect(measure('hello', 40)).toBeGreaterThan(w);
  });
});
