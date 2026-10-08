import { describe, it, expect, beforeEach } from 'vitest'
import * as Y from 'yjs'
import {
  createText,
  setTextSize,
  setTextWidthFixed,
  setTextBox,
  getTextContent,
  isEmptyText,
  deleteIfEmpty,
  snapshotText,
} from '../../src/shared/objects/text'
import { initDoc } from '../../src/shared/board-model'
import { TEXT_MIN_WIDTH_WORLD, TEXT_SIZES, DEFAULT_TEXT_SIZE } from '../../src/shared/config'

// ── helpers ──────────────────────────────────────────────────────────────────

function freshDoc(): Y.Doc {
  const doc = new Y.Doc()
  initDoc(doc)
  return doc
}

function seedText(doc: Y.Doc, id: string, text: string): void {
  const ytext = getTextContent(doc, id)
  if (ytext && text.length > 0) {
    doc.transact(() => { ytext.insert(0, text) }, null)
  }
}

// ── TC-01 ────────────────────────────────────────────────────────────────────

describe('TC-01 createText', () => {
  it('creates type=text with correct default fields', () => {
    const doc = freshDoc()
    const id = createText(doc, { x: 100, y: 50 }, 'user-1')
    expect(id).not.toBeNull()
    expect(typeof id).toBe('string')

    const ymap = (doc.getMap('objects') as Y.Map<Y.Map<unknown>>).get(id!)!
    expect(ymap).toBeDefined()
    expect(ymap.get('type')).toBe('text')
    expect(ymap.get('x')).toBe(100)
    expect(ymap.get('y')).toBe(50)
    expect(ymap.get('size')).toBe(DEFAULT_TEXT_SIZE)
    expect(ymap.get('widthMode')).toBe('auto')
    expect(ymap.get('createdBy')).toBe('user-1')

    // Y.Text must be empty initially
    const text = ymap.get('text') as Y.Text
    expect(text instanceof Y.Text).toBe(true)
    expect(text.length).toBe(0)

    // z must be > 0 (above all other objects)
    const z = ymap.get('z') as number
    expect(z).toBeGreaterThan(0)
  })

  it('z is above all existing objects', () => {
    const doc = freshDoc()
    const id1 = createText(doc, { x: 0, y: 0 }, 'u')!
    const id2 = createText(doc, { x: 10, y: 10 }, 'u')!
    const objects = doc.getMap('objects') as Y.Map<Y.Map<unknown>>
    const z1 = objects.get(id1)!.get('z') as number
    const z2 = objects.get(id2)!.get('z') as number
    expect(z2).toBeGreaterThan(z1)
  })
})

// ── TC-02 ────────────────────────────────────────────────────────────────────

describe('TC-02 setTextSize', () => {
  it('sets a valid size', () => {
    const doc = freshDoc()
    const id = createText(doc, { x: 0, y: 0 }, 'u')!
    expect(setTextSize(doc, id, 'XL')).toBe(true)
    const objects = doc.getMap('objects') as Y.Map<Y.Map<unknown>>
    expect(objects.get(id)!.get('size')).toBe('XL')
  })

  it('returns false for unknown size key', () => {
    const doc = freshDoc()
    const id = createText(doc, { x: 0, y: 0 }, 'u')!
    const objects = doc.getMap('objects') as Y.Map<Y.Map<unknown>>
    const sizeBefore = objects.get(id)!.get('size')
    expect(setTextSize(doc, id, 'XXL')).toBe(false)
    expect(objects.get(id)!.get('size')).toBe(sizeBefore)
  })

  it('all TEXT_SIZES keys are accepted', () => {
    const doc = freshDoc()
    for (const key of Object.keys(TEXT_SIZES) as (keyof typeof TEXT_SIZES)[]) {
      const id = createText(doc, { x: 0, y: 0 }, 'u')!
      expect(setTextSize(doc, id, key)).toBe(true)
    }
  })
})

// ── TC-03 ────────────────────────────────────────────────────────────────────

describe('TC-03 setTextWidthFixed', () => {
  it('clamps to TEXT_MIN_WIDTH_WORLD when below', () => {
    const doc = freshDoc()
    const id = createText(doc, { x: 0, y: 0 }, 'u')!
    setTextWidthFixed(doc, id, 30)
    const objects = doc.getMap('objects') as Y.Map<Y.Map<unknown>>
    const ymap = objects.get(id)!
    expect(ymap.get('widthMode')).toBe('fixed')
    expect(ymap.get('width')).toBe(TEXT_MIN_WIDTH_WORLD)
  })

  it('accepts a width above the minimum', () => {
    const doc = freshDoc()
    const id = createText(doc, { x: 0, y: 0 }, 'u')!
    setTextWidthFixed(doc, id, 100)
    const objects = doc.getMap('objects') as Y.Map<Y.Map<unknown>>
    expect(objects.get(id)!.get('width')).toBe(100)
    expect(objects.get(id)!.get('widthMode')).toBe('fixed')
  })

  it('exactly at the minimum is not clamped', () => {
    const doc = freshDoc()
    const id = createText(doc, { x: 0, y: 0 }, 'u')!
    setTextWidthFixed(doc, id, TEXT_MIN_WIDTH_WORLD)
    const objects = doc.getMap('objects') as Y.Map<Y.Map<unknown>>
    expect(objects.get(id)!.get('width')).toBe(TEXT_MIN_WIDTH_WORLD)
  })
})

// ── TC-04 ────────────────────────────────────────────────────────────────────

describe('TC-04 isEmptyText and deleteIfEmpty', () => {
  it('empty text object: isEmptyText returns true, deleteIfEmpty removes it', () => {
    const doc = freshDoc()
    const id = createText(doc, { x: 0, y: 0 }, 'u')!
    expect(isEmptyText(doc, id)).toBe(true)
    expect(deleteIfEmpty(doc, id)).toBe(true)
    const objects = doc.getMap('objects') as Y.Map<Y.Map<unknown>>
    expect(objects.has(id)).toBe(false)
  })

  it('whitespace-only text is NOT empty (only zero chars counts)', () => {
    const doc = freshDoc()
    const id = createText(doc, { x: 0, y: 0 }, 'u')!
    seedText(doc, id, '  ')
    expect(isEmptyText(doc, id)).toBe(false)
    expect(deleteIfEmpty(doc, id)).toBe(false)
    const objects = doc.getMap('objects') as Y.Map<Y.Map<unknown>>
    expect(objects.has(id)).toBe(true)
  })

  it('text with one character is not empty', () => {
    const doc = freshDoc()
    const id = createText(doc, { x: 0, y: 0 }, 'u')!
    seedText(doc, id, 'a')
    expect(isEmptyText(doc, id)).toBe(false)
    expect(deleteIfEmpty(doc, id)).toBe(false)
  })

  it('deleteIfEmpty on a non-existent id returns false', () => {
    const doc = freshDoc()
    expect(deleteIfEmpty(doc, 'nonexistent')).toBe(false)
  })
})

// ── TC-05 ────────────────────────────────────────────────────────────────────

describe('TC-05 clampToLimit with TEXT_MAX_CHARS (5000)', () => {
  it('clamps 5,001 chars to 5,000', async () => {
    const { clampToLimit } = await import('../../src/shared/text-edit')
    const long = 'a'.repeat(5001)
    const clamped = clampToLimit(long, 5000)
    expect(clamped.length).toBe(5000)
  })

  it('4,999 + 1 = 5,000 is accepted (boundary)', async () => {
    const { clampToLimit } = await import('../../src/shared/text-edit')
    const base = 'b'.repeat(4999)
    const clamped = clampToLimit(base + 'c', 5000)
    expect(clamped.length).toBe(5000)
    expect(clamped[4999]).toBe('c')
  })

  it('exactly 5,000 is unchanged', async () => {
    const { clampToLimit } = await import('../../src/shared/text-edit')
    const exact = 'd'.repeat(5000)
    expect(clampToLimit(exact, 5000)).toBe(exact)
  })

  it('5,001 returns exactly 5,000 characters (not more)', async () => {
    const { clampToLimit } = await import('../../src/shared/text-edit')
    const long = 'e'.repeat(5001)
    const clamped = clampToLimit(long, 5000)
    expect(clamped.length).toBe(5000)
    // All chars from input are preserved (prefix)
    expect(clamped).toBe('e'.repeat(5000))
  })
})

// ── TC-06 ────────────────────────────────────────────────────────────────────

describe('TC-06 createText with non-finite point', () => {
  it('returns null for NaN x', () => {
    const doc = freshDoc()
    expect(createText(doc, { x: NaN, y: 0 }, 'u')).toBeNull()
  })

  it('returns null for Infinity y', () => {
    const doc = freshDoc()
    expect(createText(doc, { x: 0, y: Infinity }, 'u')).toBeNull()
  })

  it('returns null for -Infinity x', () => {
    const doc = freshDoc()
    expect(createText(doc, { x: -Infinity, y: 0 }, 'u')).toBeNull()
  })

  it('no transaction: objects map has zero entries after non-finite call', () => {
    const doc = freshDoc()
    createText(doc, { x: NaN, y: NaN }, 'u')
    const objects = doc.getMap('objects') as Y.Map<unknown>
    expect(objects.size).toBe(0)
  })
})