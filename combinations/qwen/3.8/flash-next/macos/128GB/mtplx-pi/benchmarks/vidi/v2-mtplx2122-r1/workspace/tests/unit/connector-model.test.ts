import { describe, it, expect } from 'vitest'
import * as Y from 'yjs'
import { initDoc, deleteObject } from '../../src/shared/board-model'
import { createShape } from '../../src/shared/objects/shape'
import {
  createConnector,
  setConnectorEndpoint,
  snapshotConnectors,
} from '../../src/shared/objects/connector'
import type { Endpoint } from '../../src/shared/objects/connector'
import {
  sideAnchor,
  nearestSide,
  resolveEndpoints,
} from '../../src/shared/geometry/connector-geometry'
import { distanceToPolyline } from '../../src/shared/geometry/polyline'
import type { Rect, Point } from '../../src/shared/geometry/types'
import { CONNECTOR_MIN_LENGTH_WORLD } from '../../src/shared/config'

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

/** Place a shape with an exact rect (rect ≥ min so it is stored verbatim). */
function addRect(doc: Y.Doc, r: Rect): string {
  return createShape(doc, { kind: 'rect', rect: r, at: { x: r.x, y: r.y } }, 'dana')!
}

const attached = (objectId: string, fallback: Point): Endpoint =>
  ({ kind: 'attached', objectId, fallback })
const free = (x: number, y: number): Endpoint => ({ kind: 'free', x, y })

// ── TC-07 ──────────────────────────────────────────────────────────────────

describe('TC-07 attached→attached stores side anchors as fallbacks (1 update)', () => {
  it('A right side / B left side for two shapes 300 apart', () => {
    const doc = freshDoc()
    const A = addRect(doc, { x: 0, y: 0, width: 100, height: 100 })
    const B = addRect(doc, { x: 400, y: 0, width: 100, height: 100 })

    const updates = countUpdates(doc)
    const id = createConnector(doc, attached(A, { x: 0, y: 0 }), attached(B, { x: 400, y: 0 }), 'dana')
    expect(id).toBeTruthy()
    expect(updates()).toBe(1)

    const c = snapshotConnectors(doc)[0]
    expect(c.from.kind).toBe('attached')
    expect(c.to.kind).toBe('attached')
    if (c.from.kind === 'attached') {
      expect(c.from.objectId).toBe(A)
      expect(c.from.fallback).toEqual({ x: 100, y: 50 })
    }
    if (c.to.kind === 'attached') {
      expect(c.to.objectId).toBe(B)
      expect(c.to.fallback).toEqual({ x: 400, y: 50 })
    }
  })
})

// ── TC-08 (negative) ───────────────────────────────────────────────────────

describe('TC-08 self-connection is rejected', () => {
  it('A→A → null, 0 updates', () => {
    const doc = freshDoc()
    const A = addRect(doc, { x: 0, y: 0, width: 100, height: 100 })
    const updates = countUpdates(doc)
    const id = createConnector(doc, attached(A, { x: 0, y: 0 }), attached(A, { x: 100, y: 0 }), 'dana')
    expect(id).toBeNull()
    expect(updates()).toBe(0)
  })
})

// ── TC-09 (boundary) ───────────────────────────────────────────────────────

describe('TC-09 minimum connector length', () => {
  it('free→free length 7.9 → null, 0 updates', () => {
    const doc = freshDoc()
    const updates = countUpdates(doc)
    const id = createConnector(doc, free(0, 0), free(7.9, 0), 'dana')
    expect(id).toBeNull()
    expect(updates()).toBe(0)
  })

  it('free→free length exactly 8 → created, 1 update', () => {
    const doc = freshDoc()
    const updates = countUpdates(doc)
    const id = createConnector(doc, free(0, 0), free(CONNECTOR_MIN_LENGTH_WORLD, 0), 'dana')
    expect(id).toBeTruthy()
    expect(updates()).toBe(1)
  })
})

// ── TC-10 ──────────────────────────────────────────────────────────────────

describe('TC-10 nearestSide switches at the 45° diagonal', () => {
  it('right, right, top, top as B orbits A (y-up angles)', () => {
    const r: Rect = { x: 0, y: 0, width: 100, height: 100 }
    const cx = 50
    const cy = 50
    const orbit = (deg: number): Point => {
      const rad = (deg * Math.PI) / 180
      // screen y grows downward, so a mathematical angle points "up" (−y)
      return { x: cx + 200 * Math.cos(rad), y: cy - 200 * Math.sin(rad) }
    }
    expect(nearestSide(r, orbit(0))).toBe('right')
    expect(nearestSide(r, orbit(44))).toBe('right')
    expect(nearestSide(r, orbit(46))).toBe('top')
    expect(nearestSide(r, orbit(90))).toBe('top')
  })
})

// ── TC-11 (orphaned, error path) ──────────────────────────────────────────

describe('TC-11 resolveEndpoints with a missing target uses the fallback', () => {
  it('draws the orphaned end at its stored fallback, does not throw', () => {
    const A: Rect = { x: 0, y: 0, width: 100, height: 100 }
    const rects = new Map<string, Rect>()
    rects.set('A', A)
    // B is deliberately absent from rects.
    const from: Endpoint = attached('A', { x: 100, y: 50 })
    const to: Endpoint = attached('B', { x: 400, y: 50 })

    let resolved: { from: Point; to: Point } | null = null
    expect(() => { resolved = resolveEndpoints({ from, to }, rects) }).not.toThrow()
    expect(resolved!.from).toEqual({ x: 100, y: 50 }) // A's right side
    expect(resolved!.to).toEqual({ x: 400, y: 50 })   // B's stored fallback
  })
})

// ── TC-12 (negative included) ──────────────────────────────────────────────

describe('TC-12 setConnectorEndpoint', () => {
  function setupWithConnector() {
    const doc = freshDoc()
    const A = addRect(doc, { x: 0, y: 0, width: 100, height: 100 })
    const B = addRect(doc, { x: 400, y: 0, width: 100, height: 100 })
    const C = addRect(doc, { x: 800, y: 0, width: 100, height: 100 })
    const conn = createConnector(doc, attached(A, { x: 100, y: 50 }), attached(B, { x: 400, y: 50 }), 'dana')!
    return { doc, A, B, C, conn }
  }

  it('to free → updated', () => {
    const { doc, conn } = setupWithConnector()
    const updates = countUpdates(doc)
    expect(setConnectorEndpoint(doc, conn, 'to', free(500, 200))).toBe(true)
    expect(snapshotConnectors(doc)[0].to.kind).toBe('free')
    expect(updates()).toBe(1)
  })

  it('to attached C → updated', () => {
    const { doc, C, conn } = setupWithConnector()
    const updates = countUpdates(doc)
    expect(setConnectorEndpoint(doc, conn, 'to', attached(C, { x: 0, y: 0 }))).toBe(true)
    const to = snapshotConnectors(doc)[0].to
    expect(to.kind).toBe('attached')
    if (to.kind === 'attached') expect(to.objectId).toBe(C)
    expect(updates()).toBe(1)
  })

  it('to the object at the opposite end → false, 0 updates (negative)', () => {
    const { doc, A, conn } = setupWithConnector()
    // The `from` end is attached to A, so the `to` end may not attach to A.
    const updates = countUpdates(doc)
    expect(setConnectorEndpoint(doc, conn, 'to', attached(A, { x: 0, y: 0 }))).toBe(false)
    expect(updates()).toBe(0)
  })
})

// ── TC-13 ──────────────────────────────────────────────────────────────────

describe('TC-13 deleting a connected object detaches its arrow in one update', () => {
  it('deleteObject([A]) removes A, frees the arrow end at A\'s side', () => {
    const doc = freshDoc()
    const A = addRect(doc, { x: 0, y: 0, width: 100, height: 100 })
    const B = addRect(doc, { x: 400, y: 0, width: 100, height: 100 })
    createConnector(doc, attached(A, { x: 100, y: 50 }), attached(B, { x: 400, y: 50 }), 'dana')

    const updates = countUpdates(doc)
    const ok = deleteObject(doc, A)
    expect(ok).toBe(true)

    // A gone; the arrow survives with a free `from` at A's right side (100,50).
    const connectors = snapshotConnectors(doc)
    expect(connectors).toHaveLength(1)
    const c = connectors[0]
    expect(c.from.kind).toBe('free')
    if (c.from.kind === 'free') {
      expect(c.from.x).toBeCloseTo(100, 6)
      expect(c.from.y).toBeCloseTo(50, 6)
    }
    // A single update carries both the detach and the delete.
    expect(updates()).toBe(1)
  })
})

// ── TC-14 ──────────────────────────────────────────────────────────────────

describe('TC-14 distanceToPolyline on a segment', () => {
  it('0, 5.99 and 6.01 units from the segment', () => {
    const seg = [{ x: 0, y: 0 }, { x: 100, y: 0 }]
    expect(distanceToPolyline(seg, { x: 50, y: 0 })).toBeCloseTo(0, 6)
    expect(distanceToPolyline(seg, { x: 50, y: 5.99 })).toBeCloseTo(5.99, 6)
    expect(distanceToPolyline(seg, { x: 50, y: 6.01 })).toBeCloseTo(6.01, 6)
  })
})

// ── TC-29 (negative) ───────────────────────────────────────────────────────

describe('TC-29 setConnectorEndpoint on a deleted connector', () => {
  it('returns false, 0 updates', () => {
    const doc = freshDoc()
    const A = addRect(doc, { x: 0, y: 0, width: 100, height: 100 })
    const B = addRect(doc, { x: 400, y: 0, width: 100, height: 100 })
    const conn = createConnector(doc, attached(A, { x: 100, y: 50 }), attached(B, { x: 400, y: 50 }), 'dana')!
    deleteObject(doc, conn)

    const updates = countUpdates(doc)
    expect(setConnectorEndpoint(doc, conn, 'to', free(500, 200))).toBe(false)
    expect(updates()).toBe(0)
  })
})

// sanity that sideAnchor matches the anchors asserted above
describe('sideAnchor sanity', () => {
  it('returns side midpoints', () => {
    const r: Rect = { x: 0, y: 0, width: 100, height: 100 }
    expect(sideAnchor(r, 'right')).toEqual({ x: 100, y: 50 })
    expect(sideAnchor(r, 'left')).toEqual({ x: 0, y: 50 })
    expect(sideAnchor(r, 'top')).toEqual({ x: 50, y: 0 })
    expect(sideAnchor(r, 'bottom')).toEqual({ x: 50, y: 100 })
  })
})