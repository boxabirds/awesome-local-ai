import { describe, it, expect } from 'vitest'
import * as Y from 'yjs'
import {
  clampToLimit,
  applyTextDiff,
  counterVisible,
} from '../../src/client/objects/StickyText'
import { STICKY_TEXT_MAX_CHARS } from '../../src/shared/config'
import { initDoc, createSticky, getStickyText } from '../../src/shared/board-model'

// ── helpers ──────────────────────────────────────────────────────────────────

function freshDocWithText(text: string): { doc: Y.Doc; ytext: Y.Text } {
  const doc = new Y.Doc()
  initDoc(doc)
  const id = createSticky(doc, { x: 0, y: 0 })
  const ytext = getStickyText(doc, id)!
  if (text.length > 0) {
    doc.transact(() => { ytext.insert(0, text) }, null)
  }
  return { doc, ytext }
}

// Collects delta events from ytext (used to verify minimal-diff property).
function collectDeltas(ytext: Y.Text): () => Array<{ insert?: string; delete?: number; retain?: number }> {
  const deltas: Array<{ insert?: string; delete?: number; retain?: number }> = []
  ytext.observe(event => {
    const delta = (event as unknown as { delta?: Array<{ insert?: string; delete?: number; retain?: number }> }).delta
    if (delta) deltas.push(...delta)
  })
  return () => deltas
}

// ── TC-13 ─────────────────────────────────────────────────────────────────────

describe('TC-13 applyTextDiff: minimal diff', () => {
  it('"abc" → "abXc" produces a single insert at index 2 (not delete+reinsert)', () => {
    const { ytext } = freshDocWithText('abc')
    const deltasFn = collectDeltas(ytext)

    applyTextDiff(ytext, 'abXc', null)

    const deltas = deltasFn()
    // A full replace would contain a delete op; a minimal insert does not.
    expect(deltas.some(d => 'delete' in d)).toBe(false)

    const inserts = deltas.filter(d => 'insert' in d)
    expect(inserts).toHaveLength(1)
    expect(inserts[0].insert).toBe('X')

    expect((ytext as Y.Text).toString()).toBe('abXc')
  })

  it('pure deletion in middle', () => {
    const { ytext } = freshDocWithText('abcde')
    applyTextDiff(ytext, 'abde', null)
    expect((ytext as Y.Text).toString()).toBe('abde')
  })

  it('replacement of a selection', () => {
    const { ytext } = freshDocWithText('hello world')
    applyTextDiff(ytext, 'hello there', null)
    expect((ytext as Y.Text).toString()).toBe('hello there')
  })

  it('surrogate-pair emoji kept intact when inserting before', () => {
    const emoji = '\u{1F600}' // 😀 – 2 UTF-16 code-units
    const expected = 'All ' + emoji + ' done'
    const { ytext } = freshDocWithText(emoji + ' done')
    applyTextDiff(ytext, expected, null)
    const str = (ytext as Y.Text).toString()
    expect(str).toBe(expected)
    // Spread iterates code-points; the emoji must appear as exactly one entry.
    expect([...str]).toEqual([...expected])
  })
})

// ── TC-14 ─────────────────────────────────────────────────────────────────────

describe('TC-14 clampToLimit with 1,200 chars', () => {
  it('keeps exactly STICKY_TEXT_MAX_CHARS (1,000) characters', () => {
    const phrase = 'The quick brown fox jumps over the lazy dog. ' // 45 chars
    const long = (phrase.repeat(27) + 'x'.repeat(15)).slice(0, 1200)
    expect(long.length).toBe(1200)
    const clamped = clampToLimit(long)
    expect(clamped.length).toBe(STICKY_TEXT_MAX_CHARS)
    expect(clamped).toBe(long.slice(0, STICKY_TEXT_MAX_CHARS))
  })
})

// ── TC-15 ─────────────────────────────────────────────────────────────────────

describe('TC-15 boundary: 999 + 1 → 1,000 accepted', () => {
  it('999-char text accepts 1 more character', () => {
    const phrase = 'The quick brown fox jumps over the lazy dog. '
    const base = (phrase.repeat(23) + 'abcdefghi').slice(0, 999)
    expect(base.length).toBe(999)
    const clamped = clampToLimit(base + 'X')
    expect(clamped.length).toBe(1000)
    expect(clamped[999]).toBe('X')
  })
})

// ── TC-16 (negative) ──────────────────────────────────────────────────────────

describe('TC-16 boundary: 1,000 + 1 → rejected, still 1,000', () => {
  it('adding one character to a 1,000-char string does not grow it', () => {
    const phrase = 'The quick brown fox jumps over the lazy dog. '
    const base = (phrase.repeat(23) + 'abcdefghij').slice(0, STICKY_TEXT_MAX_CHARS)
    expect(base.length).toBe(STICKY_TEXT_MAX_CHARS)
    const clamped = clampToLimit(base + 'X')
    expect(clamped.length).toBe(STICKY_TEXT_MAX_CHARS)
    expect(clamped).toBe(base)
  })
})

// ── TC-17 ─────────────────────────────────────────────────────────────────────

describe('TC-17 counterVisible at threshold boundaries', () => {
  // counter shows when remaining = 1000 − length ≤ 50
  // 949 → remaining 51 → NOT visible
  // 950 → remaining 50 → visible
  // 951 → remaining 49 → visible

  it('949 chars → counter NOT visible (remaining 51 > threshold)', () => {
    expect(counterVisible(949)).toBe(false)
  })

  it('950 chars → counter visible (remaining 50 = threshold)', () => {
    expect(counterVisible(950)).toBe(true)
  })

  it('951 chars → counter visible (remaining 49 < threshold)', () => {
    expect(counterVisible(951)).toBe(true)
  })
})
