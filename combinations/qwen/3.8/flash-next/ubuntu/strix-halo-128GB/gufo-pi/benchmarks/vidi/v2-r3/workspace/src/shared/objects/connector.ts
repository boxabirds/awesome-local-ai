/**
 * Connector object model (story 10).
 * Schema helpers: create, set endpoint, detach on delete.
 */
import * as Y from 'yjs';
import { LOCAL_ORIGIN, getObjectsMap } from '../board-model';
import type { Point, Rect } from '../geometry';
import { CONNECTOR_MIN_LENGTH_WORLD } from '../config';
import { sideAnchor, nearestSide, resolveEndpoints, connectorBBox } from '../geometry/connector-geometry';

export type Endpoint =
  | { kind: 'attached'; objectId: string; fallback: Point }
  | { kind: 'free'; x: number; y: number };

export interface ConnectorSnap {
  id: string;
  type: 'connector';
  x: number;
  y: number;
  width: number;
  height: number;
  z: number;
  createdAt: number;
  createdBy: string;
  from: Endpoint;
  to: Endpoint;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isFinitePoint(p: unknown): p is Point {
  return !!p && typeof p === 'object' && isFiniteNumber((p as Point).x) && isFiniteNumber((p as Point).y);
}

function isValidEndpoint(e: unknown): e is Endpoint {
  if (!e || typeof e !== 'object') return false;
  const obj = e as Record<string, unknown>;
  if (obj.kind === 'free') return isFiniteNumber(obj.x) && isFiniteNumber(obj.y);
  if (obj.kind === 'attached') {
    return typeof obj.objectId === 'string' && obj.objectId !== '' && isFinitePoint(obj.fallback);
  }
  return false;
}

function endpointToPoint(e: Endpoint, rects: ReadonlyMap<string, Rect>): Point {
  if (e.kind === 'free') return { x: e.x, y: e.y };
  const r = rects.get(e.objectId);
  if (!r) return { x: e.fallback.x, y: e.fallback.y };
  // Use center of the object as the resolved point (actual anchor uses nearestSide with other endpoint).
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}

/**
 * Build a map of object id → Rect from the current objects map, for rect lookups.
 */
function collectRects(objects: Y.Map<Y.Map<unknown>>): Map<string, Rect> {
  const rects = new Map<string, Rect>();
  const STICKY_FALLBACK = 200;
  for (const [id, m] of objects.entries()) {
    const type = m.get('type');
    if (type === 'connector') continue; // connectors are not objects with a "rect"
    const x = m.get('x');
    const y = m.get('y');
    const w = m.get('width');
    const h = m.get('height');
    if (typeof x === 'number' && typeof y === 'number' && Number.isFinite(x) && Number.isFinite(y)) {
      rects.set(id, {
        x,
        y,
        width: typeof w === 'number' && Number.isFinite(w) ? w : STICKY_FALLBACK,
        height: typeof h === 'number' && Number.isFinite(h) ? h : STICKY_FALLBACK,
      });
    }
  }
  return rects;
}

/**
 * Create a connector. Returns new id, or null if both ends attach to the same
 * object, or resolved length < CONNECTOR_MIN_LENGTH_WORLD, or invalid input.
 */
export function createConnector(doc: Y.Doc, from: Endpoint, to: Endpoint, by: string): string | null {
  // Validate endpoints
  if (!isValidEndpoint(from) || !isValidEndpoint(to)) return null;

  // Reject same-object attachment
  if (from.kind === 'attached' && to.kind === 'attached' && from.objectId === to.objectId) return null;

  const objects = getObjectsMap(doc);
  const rects = collectRects(objects);

  // Compute resolved points for length check
  const resolved = resolveEndpoints(
    { from: from as any, to: to as any },
    rects,
  );
  const length = Math.hypot(resolved.to.x - resolved.from.x, resolved.to.y - resolved.from.y);
  if (length < CONNECTOR_MIN_LENGTH_WORLD) return null;

  // Compute fallbacks for attached endpoints = current side anchor
  const finalFrom = computeFallback(from, to, rects);
  const finalTo = computeFallback(to, from, rects);

  const id = crypto.randomUUID();

  // Compute z
  let z = 0;
  for (const m of objects.values()) {
    const zv = m.get('z');
    if (typeof zv === 'number' && zv > z) z = zv;
  }
  z += 1;

  // bbox for x/y/width/height (stored as 0, derived in snapshot)
  doc.transact(() => {
    const m = new Y.Map<unknown>();
    m.set('type', 'connector');
    m.set('x', 0);
    m.set('y', 0);
    m.set('width', 0);
    m.set('height', 0);
    m.set('z', z);
    m.set('createdAt', Date.now());
    m.set('createdBy', by);
    m.set('from', encodeEndpoint(finalFrom));
    m.set('to', encodeEndpoint(finalTo));
    objects.set(id, m);
  }, LOCAL_ORIGIN);

  return id;
}

/**
 * Compute fallback for an attached endpoint: the current side anchor.
 */
function computeFallback(
  self: Endpoint,
  other: Endpoint,
  rects: ReadonlyMap<string, Rect>,
): Endpoint {
  if (self.kind === 'free') return self;

  const r = rects.get(self.objectId);
  if (!r) return self; // fallback already stored as-is

  // Other endpoint point
  let otherPoint: Point;
  if (other.kind === 'free') {
    otherPoint = { x: other.x, y: other.y };
  } else {
    const otherRect = rects.get(other.objectId);
    otherPoint = otherRect
      ? { x: otherRect.x + otherRect.width / 2, y: otherRect.y + otherRect.height / 2 }
      : { x: other.fallback.x, y: other.fallback.y };
  }

  const side = nearestSide(r, otherPoint);
  const anchor = sideAnchor(r, side);
  return { kind: 'attached', objectId: self.objectId, fallback: anchor };
}

function encodeEndpoint(e: Endpoint): Y.Map<unknown> {
  const m = new Y.Map<unknown>();
  m.set('kind', e.kind);
  if (e.kind === 'attached') {
    m.set('objectId', e.objectId);
    m.set('fallback', encodePoint(e.fallback));
  } else {
    m.set('x', e.x);
    m.set('y', e.y);
  }
  return m;
}

function encodePoint(p: Point): Y.Map<number> {
  const m = new Y.Map<number>();
  m.set('x', p.x);
  m.set('y', p.y);
  return m;
}

function decodeEndpoint(m: unknown): Endpoint | null {
  if (!(m instanceof Y.Map)) return null;
  const kind = m.get('kind');
  if (kind === 'free') {
    const x = m.get('x');
    const y = m.get('y');
    if (!isFiniteNumber(x) || !isFiniteNumber(y)) return null;
    return { kind: 'free', x, y };
  }
  if (kind === 'attached') {
    const objectId = m.get('objectId');
    const fallback = m.get('fallback');
    if (typeof objectId !== 'string' || objectId === '') return null;
    const pt = decodePoint(fallback);
    if (!pt) return null;
    return { kind: 'attached', objectId, fallback: pt };
  }
  return null;
}

function decodePoint(v: unknown): Point | null {
  if (!(v instanceof Y.Map)) return null;
  const x = v.get('x');
  const y = v.get('y');
  if (!isFiniteNumber(x) || !isFiniteNumber(y)) return null;
  return { x, y };
}

/**
 * Update one endpoint of a connector.
 * Returns false if connector missing, non-finite point, or attaching to the opposite end's object.
 */
export function setConnectorEndpoint(doc: Y.Doc, id: string, end: 'from' | 'to', e: Endpoint): boolean {
  if (typeof id !== 'string' || id === '') return false;
  const objects = getObjectsMap(doc);
  const m = objects.get(id);
  if (!m || m.get('type') !== 'connector') return false;
  if (!isValidEndpoint(e)) return false;

  // Check if attaching to the object at the opposite end
  const otherEndKey = end === 'from' ? 'to' : 'from';
  const otherRaw = m.get(otherEndKey);
  const other = decodeEndpoint(otherRaw);
  if (other && e.kind === 'attached' && other.kind === 'attached' && e.objectId === other.objectId) {
    return false;
  }

  doc.transact(() => {
    m.set(end, encodeEndpoint(e));
    // Recompute stored x/y/width/height
    const from = decodeEndpoint(m.get('from'));
    const to = decodeEndpoint(m.get('to'));
    if (from && to) {
      const pts = resolveEndpoints({ from: from as any, to: to as any }, collectRects(objects));
      const bbox = connectorBBox(pts.from, pts.to);
      m.set('x', bbox.x);
      m.set('y', bbox.y);
      m.set('width', bbox.width);
      m.set('height', bbox.height);
    }
  }, LOCAL_ORIGIN);

  return true;
}

/**
 * Detach connector endpoints attached to any of the deleted ids.
 * Call inside an already-open transaction (e.g. inside deleteObjects).
 * Each attached endpoint pointing to a deleted id becomes free at the current anchor.
 */
export function detachConnectorsTo(doc: Y.Doc, deletedIds: string[]): void {
  const objects = getObjectsMap(doc);
  const rectMap = collectRects(objects);
  const deleteSet = new Set(deletedIds);

  for (const [, m] of objects.entries()) {
    if (m.get('type') !== 'connector') continue;

    let changed = false;
    for (const key of ['from', 'to'] as const) {
      const raw = m.get(key);
      if (!(raw instanceof Y.Map)) continue;
      const kind = raw.get('kind');
      if (kind !== 'attached') continue;
      const objectId = raw.get('objectId');
      if (typeof objectId !== 'string' || !deleteSet.has(objectId)) continue;

      // Compute current anchor (where it is now drawn)
      const r = rectMap.get(objectId);
      let anchor: Point;
      if (r) {
        const otherKey = key === 'from' ? 'to' : 'from';
        const other = decodeEndpoint(m.get(otherKey));
        let otherPoint: Point;
        if (other && other.kind === 'attached') {
          const or = rectMap.get(other.objectId);
          otherPoint = or ? { x: or.x + or.width / 2, y: or.y + or.height / 2 } : { x: other.fallback.x, y: other.fallback.y };
        } else if (other && other.kind === 'free') {
          otherPoint = { x: other.x, y: other.y };
        } else {
          otherPoint = { x: r.x + r.width / 2, y: r.y + r.height / 2 };
        }
        const side = nearestSide(r, otherPoint);
        anchor = sideAnchor(r, side);
      } else {
        // Use stored fallback as last known
        const fb = decodePoint(raw.get('fallback'));
        anchor = fb ? { x: fb.x, y: fb.y } : { x: 0, y: 0 };
      }

      const freeMap = new Y.Map<unknown>();
      freeMap.set('kind', 'free');
      freeMap.set('x', anchor.x);
      freeMap.set('y', anchor.y);
      m.set(key, freeMap);
      changed = true;
    }
    // We rely on the caller's transaction, do not commit here
    void changed;
  }
}

/**
 * Read a connector from a Y.Map into a ConnectorSnap (used by snapshot()).
 */
export function readConnector(id: string, m: Y.Map<unknown>): ConnectorSnap | null {
  if (m.get('type') !== 'connector') return null;
  const from = decodeEndpoint(m.get('from'));
  const to = decodeEndpoint(m.get('to'));
  if (!from || !to) return null;

  const z = m.get('z');
  const createdAt = m.get('createdAt');
  const createdBy = m.get('createdBy');
  const x = m.get('x');
  const y = m.get('y');
  const width = m.get('width');
  const height = m.get('height');

  if (!isFiniteNumber(z)) return null;

  return {
    id,
    type: 'connector',
    x: isFiniteNumber(x) ? x : 0,
    y: isFiniteNumber(y) ? y : 0,
    width: isFiniteNumber(width) ? width : 0,
    height: isFiniteNumber(height) ? height : 0,
    z,
    createdAt: isFiniteNumber(createdAt) ? createdAt : 0,
    createdBy: typeof createdBy === 'string' ? createdBy : '',
    from,
    to,
  };
}
