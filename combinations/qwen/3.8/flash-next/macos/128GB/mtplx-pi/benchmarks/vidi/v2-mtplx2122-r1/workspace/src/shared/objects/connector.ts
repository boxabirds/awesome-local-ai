import * as Y from 'yjs'
import { LOCAL_ORIGIN } from '../board-model'
import { STICKY_SIZE_WORLD, CONNECTOR_MIN_LENGTH_WORLD } from '../config'
import type { Point, Rect } from '../geometry/types'
import {
  type Endpoint,
  resolveEndpoints,
  connectorBBox,
  sideAnchor,
  nearestSide,
} from '../geometry/connector-geometry'

export type { Endpoint }

// ── Snapshot ──────────────────────────────────────────────────────────────────

export interface ConnectorSnap {
  id: string
  type: 'connector'
  /** Stored endpoints (attached / free). */
  from: Endpoint
  to: Endpoint
  /** Resolved drawn points recomputed from the current rects map. */
  fromPoint: Point
  toPoint: Point
  /** Bounding box derived from the resolved points (x/y/width/height stored 0). */
  x: number
  y: number
  width: number
  height: number
  z: number
  createdAt: number
  createdBy: string
}

// ── helpers ─────────────────────────────────────────────────────────────────

function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects') as Y.Map<Y.Map<unknown>>
}

function maxZ(doc: Y.Doc): number {
  let max = 0
  objectsMap(doc).forEach((ymap: Y.Map<unknown>) => {
    const z = ymap.get('z') as number | undefined
    if (typeof z === 'number' && z > max) max = z
  })
  return max
}

/** The rectangle of any object that a connector end can attach to. Used both
 *  to resolve arrow endpoints and to hit-test the object under a pointer. */
export function objectRect(ymap: Y.Map<unknown>): Rect | null {
  const type = ymap.get('type')
  if (type === 'sticky') {
    return {
      x: ymap.get('x') as number,
      y: ymap.get('y') as number,
      width: STICKY_SIZE_WORLD,
      height: STICKY_SIZE_WORLD,
    }
  }
  if (type === 'text' || type === 'shape') {
    return {
      x: ymap.get('x') as number,
      y: ymap.get('y') as number,
      width: (ymap.get('width') as number) ?? 0,
      height: (ymap.get('height') as number) ?? 0,
    }
  }
  return null
}

/** Build a fresh id→rect map of every attachable object (called per snapshot /
 *  per create so attached arrows follow any move). */
export function collectRects(doc: Y.Doc): Map<string, Rect> {
  const rects = new Map<string, Rect>()
  objectsMap(doc).forEach((ymap: Y.Map<unknown>, id: string) => {
    const r = objectRect(ymap)
    if (r) rects.set(id, r)
  })
  return rects
}

function dist(a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  return Math.sqrt(dx * dx + dy * dy)
}

function finitePoint(p: Point): boolean {
  return Number.isFinite(p.x) && Number.isFinite(p.y)
}

function finiteEndpoint(e: Endpoint): boolean {
  if (!e) return false
  if (e.kind === 'free') return finitePoint({ x: e.x, y: e.y })
  return !!e.fallback && finitePoint(e.fallback)
}

/** Store an endpoint with a freshly-computed fallback anchor for attached ends
 *  (free ends keep their point). */
function storedEndpoint(end: Endpoint, anchor: Point): Endpoint {
  if (end.kind === 'free') return { kind: 'free', x: end.x, y: end.y }
  return { kind: 'attached', objectId: end.objectId, fallback: { x: anchor.x, y: anchor.y } }
}

function cloneEndpoint(e: Endpoint): Endpoint {
  return e.kind === 'free'
    ? { kind: 'free', x: e.x, y: e.y }
    : { kind: 'attached', objectId: e.objectId, fallback: { x: e.fallback.x, y: e.fallback.y } }
}

// ── createConnector ─────────────────────────────────────────────────────────

/**
 * Create an arrow from `from` to `to`.
 *
 * Returns null (no transaction) when both ends attach to the same object, when
 * a point is non-finite, or when the resolved length is below
 * {@link CONNECTOR_MIN_LENGTH_WORLD}. Attached ends are stored with a
 * `fallback` = the side-anchor at creation; the side itself is recomputed every
 * render, so the arrow follows and switches sides without further writes.
 */
export function createConnector(
  doc: Y.Doc,
  from: Endpoint,
  to: Endpoint,
  by: string,
): string | null {
  if (!finiteEndpoint(from) || !finiteEndpoint(to)) return null
  if (from.kind === 'attached' && to.kind === 'attached' && from.objectId === to.objectId) {
    return null
  }

  const rects = collectRects(doc)
  const resolved = resolveEndpoints({ from, to }, rects)
  if (dist(resolved.from, resolved.to) < CONNECTOR_MIN_LENGTH_WORLD) return null

  const id = crypto.randomUUID()

  doc.transact(() => {
    const objects = objectsMap(doc)
    const ymap = new Y.Map<unknown>()
    ymap.set('type', 'connector')
    ymap.set('from', storedEndpoint(from, resolved.from))
    ymap.set('to', storedEndpoint(to, resolved.to))
    // Geometry is derived in snapshot()/render; store zeros as placeholders so
    // the object shape matches the shared "common fields" layout.
    ymap.set('x', 0)
    ymap.set('y', 0)
    ymap.set('width', 0)
    ymap.set('height', 0)
    ymap.set('z', maxZ(doc) + 1)
    ymap.set('createdAt', Date.now())
    ymap.set('createdBy', by)
    objects.set(id, ymap)
  }, LOCAL_ORIGIN)

  return id
}

// ── setConnectorEndpoint ──────────────────────────────────────────────────────

/**
 * Re-point one end of a connector (drag of an end handle).
 *
 * Returns false (no transaction) for a stale id / non-connector, a non-finite
 * endpoint, or when the new `attached` target is the object at the opposite
 * end. Otherwise writes the new endpoint in one transaction.
 */
export function setConnectorEndpoint(
  doc: Y.Doc,
  id: string,
  end: 'from' | 'to',
  e: Endpoint,
): boolean {
  const ymap = objectsMap(doc).get(id)
  if (!ymap || ymap.get('type') !== 'connector') return false
  if (!finiteEndpoint(e)) return false

  const curFrom = ymap.get('from') as Endpoint
  const curTo = ymap.get('to') as Endpoint
  const opposite = end === 'from' ? curTo : curFrom
  const oppositeObj = opposite && opposite.kind === 'attached' ? opposite.objectId : undefined
  if (e.kind === 'attached' && e.objectId === oppositeObj) return false

  const rects = collectRects(doc)
  const newFrom = end === 'from' ? e : curFrom
  const newTo = end === 'to' ? e : curTo
  const resolved = resolveEndpoints({ from: newFrom, to: newTo }, rects)
  const anchor = end === 'from' ? resolved.from : resolved.to

  doc.transact(() => {
    ymap.set(end, storedEndpoint(e, anchor))
  }, LOCAL_ORIGIN)

  return true
}

// ── detachConnectorsTo ────────────────────────────────────────────────────────

/**
 * Convert every connector end attached to one of `deletedIds` into a free end
 * fixed at the point where it was attached. Call inside an already-open
 * transaction (story 7's deleteObjects wraps it) so the delete is one update.
 * Reads rects before deletion so the anchor is the object's current side.
 */
export function detachConnectorsTo(doc: Y.Doc, deletedIds: string[]): void {
  if (deletedIds.length === 0) return
  const deleted = new Set(deletedIds)
  const objects = objectsMap(doc)
  const rects = collectRects(doc)

  objects.forEach((ymap: Y.Map<unknown>) => {
    if (ymap.get('type') !== 'connector') return
    const from = ymap.get('from') as Endpoint
    const to = ymap.get('to') as Endpoint
    if (!from || !to) return

    const fromAttached = from.kind === 'attached' && deleted.has(from.objectId)
    const toAttached = to.kind === 'attached' && deleted.has(to.objectId)
    if (!fromAttached && !toAttached) return

    // Resolve with rects that still contain the doomed object so the arrow
    // stays exactly where its side was.
    const resolved = resolveEndpoints({ from, to }, rects)
    const changes: Array<[string, Endpoint]> = []
    if (fromAttached) {
      changes.push(['from', { kind: 'free', x: resolved.from.x, y: resolved.from.y }])
    }
    if (toAttached) {
      changes.push(['to', { kind: 'free', x: resolved.to.x, y: resolved.to.y }])
    }
    for (const [key, ep] of changes) ymap.set(key, ep)
  })
}

// ── snapshot ──────────────────────────────────────────────────────────────────

export function snapshotConnectors(doc: Y.Doc): readonly ConnectorSnap[] {
  const rects = collectRects(doc)
  const result: ConnectorSnap[] = []

  objectsMap(doc).forEach((ymap: Y.Map<unknown>, id: string) => {
    if (ymap.get('type') !== 'connector') return

    const fromRaw = ymap.get('from') as Endpoint | undefined
    const toRaw = ymap.get('to') as Endpoint | undefined
    if (!fromRaw || !toRaw) return

    const from = cloneEndpoint(fromRaw)
    const to = cloneEndpoint(toRaw)
    const resolved = resolveEndpoints({ from, to }, rects)
    const bbox = connectorBBox(resolved.from, resolved.to)

    result.push({
      id,
      type: 'connector' as const,
      from,
      to,
      fromPoint: resolved.from,
      toPoint: resolved.to,
      x: bbox.x,
      y: bbox.y,
      width: bbox.width,
      height: bbox.height,
      z: (ymap.get('z') as number) ?? 0,
      createdAt: (ymap.get('createdAt') as number) ?? 0,
      createdBy: (ymap.get('createdBy') as string) ?? '',
    })
  })

  result.sort((a, b) => {
    if (a.z !== b.z) return a.z - b.z
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })

  return Object.freeze(result)
}

// Re-exported for the toolbar/tool layer that highlights the target side.
export { sideAnchor, nearestSide }