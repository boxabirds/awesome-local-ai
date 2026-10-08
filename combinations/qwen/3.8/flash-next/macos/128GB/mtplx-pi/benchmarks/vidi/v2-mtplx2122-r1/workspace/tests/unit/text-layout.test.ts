import { describe, it, expect } from 'vitest'
import { layoutText, createCanvasMeasurer } from '../../src/client/objects/textLayout'
import type { Measurer } from '../../src/client/objects/textLayout'
import {
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_SIZES,
  TEXT_LINE_HEIGHT,
} from '../../src/shared/config'

// ── helpers ──────────────────────────────────────────────────────────────────

/**
 * A fake measurer that returns `text.length * 6` pixels for every font size.
 * At M (20px) one character ≈ 6 px wide.
 */
function fakeMeasurer(factor = 6): Measurer {
  return (text: string, _fontPx: number) => text.length * factor
}

// ── TC-07 ────────────────────────────────────────────────────────────────────

describe('TC-07 layoutText "Went well" at M with fake measurer', () => {
  const text = 'Went well' // 9 chars
  const result = layoutText(text, 'M', 'auto', null, fakeMeasurer(10))

  it('one line (fits in auto-width)', () => {
    // 9 chars × 10 px = 90 px < TEXT_MAX_AUTO_WIDTH_WORLD (600)
    expect(result.lines.length).toBe(1)
    expect(result.lines[0]).toBe('Went well')
  })

  it('width equals the measured text width (90)', () => {
    expect(result.width).toBe(90)
  })

  it('height is one line × fontPx × TEXT_LINE_HEIGHT', () => {
    const expectedHeight = 1 * TEXT_SIZES['M'] * TEXT_LINE_HEIGHT
    expect(result.height).toBeCloseTo(expectedHeight, 2)
  })
})

// ── TC-08 ────────────────────────────────────────────────────────────────────

describe('TC-08 line longer than TEXT_MAX_AUTO_WIDTH_WORLD', () => {
  // 150 chars at 6 px/char = 900 px > TEXT_MAX_AUTO_WIDTH_WORLD (600).
  // Use words of 5 chars + spaces so the word-wrap has valid break points.
  // 'abcde ' * 30 = 179 chars; use 'word ' * 36 trimmed = 180 chars.
  // Let's just use a 100-char continuous word so it becomes one line but wider than 600.
  const longNoSpaces = 'A'.repeat(150) // 150 × 6 = 900 px with fakeMeasurer(6)

  it('width is capped at TEXT_MAX_AUTO_WIDTH_WORLD', () => {
    const result = layoutText(longNoSpaces, 'M', 'auto', null, fakeMeasurer(6))
    // 900 px raw line > 600 → capped to 600
    expect(result.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD)
  })

  it('a line wider than maxW is word-wrapped; here no spaces so stays 1 line but width capped', () => {
    const result = layoutText(longNoSpaces, 'M', 'auto', null, fakeMeasurer(6))
    // No spaces: greedy word-wrap has no break point → 1 line (no wrapping possible)
    // Height = 1 line
    expect(result.height).toBeGreaterThan(0)
  })

  it('word-wraps a space-separated sentence that exceeds maxW', () => {
    // 'word ' * 100 = 499 chars; 499×6=2994 px >> 600
    const sentence = ('word '.repeat(100)).trim()
    const result = layoutText(sentence, 'M', 'auto', null, fakeMeasurer(6))
    expect(result.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD)
    expect(result.lines.length).toBeGreaterThan(1)
  })

  it('height scales with number of lines', () => {
    const sentence = ('word '.repeat(100)).trim()
    const result = layoutText(sentence, 'M', 'auto', null, fakeMeasurer(6))
    const expectedHeight = result.lines.length * TEXT_SIZES['M'] * TEXT_LINE_HEIGHT
    expect(result.height).toBeCloseTo(expectedHeight, 2)
  })
})

// ── TC-09 ────────────────────────────────────────────────────────────────────

describe('TC-09 line exactly at TEXT_MAX_AUTO_WIDTH_WORLD (boundary)', () => {
  // Make a line that measures exactly 600 px: 600 / 6 = 100 chars
  const exactLine = 'x'.repeat(100)
  const measurer = fakeMeasurer(6) // 100 × 6 = 600

  it('width equals TEXT_MAX_AUTO_WIDTH_WORLD exactly', () => {
    const result = layoutText(exactLine, 'M', 'auto', null, measurer)
    expect(result.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD)
  })

  it('no wrapping at exactly the limit (one line)', () => {
    const result = layoutText(exactLine, 'M', 'auto', null, measurer)
    // 100 'x' chars have no spaces – no word boundary to break on
    // so it stays as one line (long-word case)
    expect(result.lines.length).toBe(1)
  })
})

// ── TC-10 ────────────────────────────────────────────────────────────────────

describe('TC-10 fixed width with three words – each word wraps', () => {
  // Fixed width 40; measurer returns 6 per char.
  // Three words, each 8 chars → each 48 px > 40 → all three wrap individually.
  const text = 'abcdefgh ijklmnop qrstuvwx'
  const result = layoutText(text, 'M', 'fixed', 40, fakeMeasurer(6))

  it('three lines (one word each)', () => {
    expect(result.lines.length).toBe(3)
  })

  it('height = 3 lines × M font × TEXT_LINE_HEIGHT', () => {
    const expectedHeight = 3 * TEXT_SIZES['M'] * TEXT_LINE_HEIGHT
    expect(result.height).toBeCloseTo(expectedHeight, 2)
  })

  it('width stays at fixedWidth', () => {
    expect(result.width).toBe(40)
  })
})

// ── TC-11 ────────────────────────────────────────────────────────────────────

describe('TC-11 multi-line text with explicit newlines', () => {
  const text = 'first\nsecond\nthird'
  // Each line ≤ 6 chars. At 6 px/char the widest is 36 px < 600.
  const result = layoutText(text, 'M', 'auto', null, fakeMeasurer(6))

  it('three lines', () => {
    expect(result.lines.length).toBe(3)
  })

  it('width = width of longest line (second = 6 chars × 6 = 36)', () => {
    // All three are 5-6 chars; 'second' is 6 → 36
    expect(result.width).toBeCloseTo(36, 0)
  })

  it('height = 3 × fontPx × TEXT_LINE_HEIGHT', () => {
    const expectedHeight = 3 * TEXT_SIZES['M'] * TEXT_LINE_HEIGHT
    expect(result.height).toBeCloseTo(expectedHeight, 2)
  })
})

// ── TC-32 ────────────────────────────────────────────────────────────────────

describe('TC-32 createCanvasMeasurer in jsdom (no canvas) – fallback', () => {
  it('does not throw when canvas is unavailable', () => {
    // jsdom doesn't provide a real canvas context
    const m = createCanvasMeasurer()
    expect(() => m('hello world', 20)).not.toThrow()
  })

  it('returns a positive number', () => {
    const m = createCanvasMeasurer()
    const w = m('hello', 20)
    expect(w).toBeGreaterThan(0)
  })

  it('longer text returns larger width', () => {
    const m = createCanvasMeasurer()
    const w1 = m('hi', 20)
    const w2 = m('hello world', 20)
    expect(w2).toBeGreaterThan(w1)
  })
})