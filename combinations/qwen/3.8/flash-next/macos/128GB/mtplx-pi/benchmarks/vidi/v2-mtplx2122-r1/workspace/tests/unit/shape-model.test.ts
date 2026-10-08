import { describe, it, expect } from 'vitest'
import * as Y from 'yjs'
import { initDoc } from '../../src/shared/board-model'
import {
  createShape,
  setShapeStyle,
  getShapeLabel,
  snapshotShapes,
} from '../../src/shared/objects/shape'
import {
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_MIN_SIZE_WORLD,
  DEFAULT_SHAPE_FILL,
  DEFAULT_SHAPE_STROKE,
} from '../../src/shared/config'

function freshDoc(): Y.Doc {
  const d = new Y.Doc()
  initDoc(d)
  return d
}

function countUpdates(doc: Y.Doc): () => number {
  let n = 0
  doc.on('update', () => { n++ })
  return () => n
}

// ── TC-01 ────────────────────────────────────────────────────────────────────

describe('TC-01 createShape by drag', () => {
  it('creates a 200x120 rect with defaults, z=1, creator set, 1 update', () => {
    const doc = freshDoc()
    const updates = countUpdates(doc)
    const id = createShape(
      doc,
      { kind: 'rect', rect: { x: 100, y: 100, width: 200, height: 120 }, at: { x: 100, y: 100 } },
      'dana',
    )
    expect(id).toBeTruthy()

    const snap = snapshotShapes(doc)
    expect(snap).toHaveLength(1)
    const s = snap[0]
    expect(s.type).toBe('shape')
    expect(s.kind).toBe('rect')
    expect(s.width).toBe(200)
    expect(s.height).toBe(120)
    expect(s.fill).toBe(DEFAULT_SHAPE_FILL)
    expect(s.stroke).toBe(DEFAULT_SHAPE_STROKE)
    expect(s.label).toBe('')
    expect(s.z).toBe(1)
    expect(s.createdBy).toBe('dana')
    expect(updates()).toBe(1)
  })
})

// ── TC-02 ──────────────────────────────────────────────────────────────────

describe('TC-02 click / tiny drag drops a standard 160×160 shape', () => {
  it('rect 19x200 (below min in one axis) → default square centred at `at`', () => {
    const doc = freshDoc()
    const updates = countUpdates(doc)
    createShape(
      doc,
      { kind: 'rect', rect: { x: 0, y: 0, width: 19, height: 200 }, at: { x: 0, y: 0 } },
      'dana',
    )
    const s = snapshotShapes(doc)[0]
    expect(s.width).toBe(SHAPE_DEFAULT_SIZE_WORLD)
    expect(s.height).toBe(SHAPE_DEFAULT_SIZE_WORLD)
    // centred on at (0,0)
    expect(s.x).toBeCloseTo(-SHAPE_DEFAULT_SIZE_WORLD / 2, 10)
    expect(s.y).toBeCloseTo(-SHAPE_DEFAULT_SIZE_WORLD / 2, 10)
    expect(updates()).toBe(1)
  })

  it('rect null → default square centred at `at`', () => {
    const doc = freshDoc()
    const updates = countUpdates(doc)
    createShape(doc, { kind: 'ellipse', rect: null, at: { x: 50, y: 40 } }, 'dana')
    const s = snapshotShapes(doc)[0]
    expect(s.width).toBe(SHAPE_DEFAULT_SIZE_WORLD)
    expect(s.height).toBe(SHAPE_DEFAULT_SIZE_WORLD)
    expect(s.x).toBeCloseTo(50 - SHAPE_DEFAULT_SIZE_WORLD / 2, 10)
    expect(s.y).toBeCloseTo(40 - SHAPE_DEFAULT_SIZE_WORLD / 2, 10)
    expect(s.kind).toBe('ellipse')
    expect(updates()).toBe(1)
  })
})

// ── TC-03 ──────────────────────────────────────────────────────────────────

describe('TC-03 exact minimum size is kept (boundary)', () => {
  it('a 20×20 drag is kept, not turned into a default shape', () => {
    const doc = freshDoc()
    createShape(
      doc,
      { kind: 'rect', rect: { x: 5, y: 5, width: SHAPE_MIN_SIZE_WORLD, height: SHAPE_MIN_SIZE_WORLD }, at: { x: 5, y: 5 } },
      'dana',
    )
    const s = snapshotShapes(doc)[0]
    expect(s.width).toBe(SHAPE_MIN_SIZE_WORLD)
    expect(s.height).toBe(SHAPE_MIN_SIZE_WORLD)
    expect(s.x).toBe(5)
    expect(s.y).toBe(5)
  })
})

// ── TC-04 ──────────────────────────────────────────────────────────────────

describe('TC-04 Shift (square) uses the larger dimension anchored at origin', () => {
  it('200×120 becomes 200×200 keeping the top-left origin', () => {
    const doc = freshDoc()
    createShape(
      doc,
      { kind: 'rect', rect: { x: 100, y: 100, width: 200, height: 120 }, at: { x: 100, y: 100 }, square: true },
      'dana',
    )
    const s = snapshotShapes(doc)[0]
    expect(s.width).toBe(200)
    expect(s.height).toBe(200)
    expect(s.x).toBe(100)
    expect(s.y).toBe(100)
  })
})

// ── TC-05 ──────────────────────────────────────────────────────────────────

describe('TC-05 setShapeStyle recolours without touching label/size/position', () => {
  it('valid fill applied; label + geometry unchanged (1 update)', () => {
    const doc = freshDoc()
    const id = createShape(
      doc,
      { kind: 'rect', rect: { x: 100, y: 100, width: 200, height: 120 }, at: { x: 100, y: 100 } },
      'dana',
    )!
    // give the shape a label so we can prove it is preserved
    const ytext = getShapeLabel(doc, id)!
    expect(ytext).toBeInstanceOf(Y.Text)
    ytext.insert(0, 'Checkout')

    const updates = countUpdates(doc)
    const ok = setShapeStyle(doc, id, { fill: 'blue' })
    expect(ok).toBe(true)

    const s = snapshotShapes(doc)[0]
    expect(s.fill).toBe('blue')
    expect(s.stroke).toBe(DEFAULT_SHAPE_STROKE)
    expect(s.label).toBe('Checkout')
    expect(s.width).toBe(200)
    expect(s.height).toBe(120)
    expect(s.x).toBe(100)
    expect(s.y).toBe(100)
    expect(updates()).toBe(1)
  })

  it('unknown colour returns false and writes nothing (0 updates)', () => {
    const doc = freshDoc()
    const id = createShape(
      doc,
      { kind: 'rect', rect: { x: 0, y: 0, width: 100, height: 100 }, at: { x: 0, y: 0 } },
      'dana',
    )!
    const updates = countUpdates(doc)
    const ok = setShapeStyle(doc, id, { fill: 'teal' })
    expect(ok).toBe(false)
    expect(snapshotShapes(doc)[0].fill).toBe(DEFAULT_SHAPE_FILL)
    expect(updates()).toBe(0)
  })

  it('stale id returns false, 0 updates', () => {
    const doc = freshDoc()
    const updates = countUpdates(doc)
    expect(setShapeStyle(doc, 'nope', { fill: 'blue' })).toBe(false)
    expect(updates()).toBe(0)
  })
})

// ── TC-06 (error paths) ────────────────────────────────────────────────────

describe('TC-06 invalid kind / non-finite rect create nothing', () => {
  it('unknown kind → null, 0 updates', () => {
    const doc = freshDoc()
    const updates = countUpdates(doc)
    const id = createShape(
      doc,
      // @ts-expect-error deliberately invalid kind
      { kind: 'triangle', rect: { x: 0, y: 0, width: 100, height: 100 }, at: { x: 0, y: 0 } },
      'dana',
    )
    expect(id).toBeNull()
    expect(updates()).toBe(0)
  })

  it('non-finite rect → null, 0 updates', () => {
    const doc = freshDoc()
    const updates = countUpdates(doc)
    const id = createShape(
      doc,
      { kind: 'rect', rect: { x: 0, y: 0, width: NaN, height: 100 }, at: { x: 0, y: 0 } },
      'dana',
    )
    expect(id).toBeNull()
    expect(updates()).toBe(0)
  })

  it('non-finite point → null, 0 updates', () => {
    const doc = freshDoc()
    const updates = countUpdates(doc)
    const id = createShape(
      doc,
      { kind: 'rect', rect: null, at: { x: Infinity, y: 0 } },
      'dana',
    )
    expect(id).toBeNull()
    expect(updates()).toBe(0)
  })
})