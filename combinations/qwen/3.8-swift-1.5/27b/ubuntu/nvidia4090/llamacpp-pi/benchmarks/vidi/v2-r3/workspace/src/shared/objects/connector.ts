import * as Y from 'yjs';
import {
  CONNECTOR_MIN_LENGTH_WORLD,
} from '../config';
import { LOCAL_ORIGIN } from '../board-model';
import { type Endpoint, resolveEndpoints, connectorBBox } from '../geometry/connector-geometry';
import type { Rect } from '../geometry';

const OBJECT_TYPE_CONNECTOR = 'connector';

function isFiniteNumber(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects') as Y.Map<Y.Map<unknown>>;
}

function objectMap(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  return objectsMap(doc).get(id);
}

function maxZ(doc: Y.Doc): number {
  let max = 0;
  for (const m of objectsMap(doc).values()) {
    const z = m.get('z');
    if (isFiniteNumber(z) && z > max) max = z;
  }
  return max;
}

/**
 * Create a connector between two endpoints.
 *
 * Returns `null` when:
 * - both ends attach to the same object
 * - the resolved length is below CONNECTOR_MIN_LENGTH_WORLD
 *
 * One LOCAL_ORIGIN transaction on success.
 */
export function createConnector(
  doc: Y.Doc,
  from: Endpoint,
  to: Endpoint,
  by: string,
): string | null {
  // Check for self-connection
  if (from.kind === 'attached' && to.kind === 'attached' && from.objectId === to.objectId) {
    return null;
  }

  // Compute the resolved positions to check minimum length
  const fromPoint = from.kind === 'free' ? { x: from.x, y: from.y } : from.fallback;
  const toPoint = to.kind === 'free' ? { x: to.x, y: to.y } : to.fallback;
  const len = Math.hypot(toPoint.x - fromPoint.x, toPoint.y - fromPoint.y);
  if (len < CONNECTOR_MIN_LENGTH_WORLD) return null;

  const id = crypto.randomUUID();
  doc.transact(() => {
    const m = new Y.Map<unknown>();
    m.set('type', OBJECT_TYPE_CONNECTOR);
    m.set('x', 0);
    m.set('y', 0);
    m.set('width', 0);
    m.set('height', 0);
    m.set('from', serializeEndpoint(from));
    m.set('to', serializeEndpoint(to));
    m.set('z', maxZ(doc) + 1);
    m.set('createdAt', Date.now());
    m.set('createdBy', by);
    objectsMap(doc).set(id, m);
  }, LOCAL_ORIGIN);
  return id;
}

/**
 * Set one endpoint of a connector. Returns `false` for:
 * - stale connector id
 * - non-finite points
 * - attaching to the object at the opposite end
 */
export function setConnectorEndpoint(
  doc: Y.Doc,
  id: string,
  end: 'from' | 'to',
  e: Endpoint,
): boolean {
  const m = objectMap(doc, id);
  if (!m) return false;

  // Validate point finiteness
  if (e.kind === 'free') {
    if (!isFiniteNumber(e.x) || !isFiniteNumber(e.y)) return false;
  }

  // Check if attaching to the opposite end's object
  const oppositeKey = end === 'from' ? 'to' : 'from';
  const oppositeRaw = m.get(oppositeKey);
  if (e.kind === 'attached') {
    const opposite = deserializeEndpoint(oppositeRaw);
    if (opposite && opposite.kind === 'attached' && opposite.objectId === e.objectId) {
      return false;
    }
  }

  doc.transact(() => {
    m.set(end, serializeEndpoint(e));
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Detach all connector endpoints attached to any of `deletedIds`.
 * Must be called inside an open transaction (the caller's transaction).
 * Each attached end becomes free at the current anchor point.
 */
export function detachConnectorsTo(doc: Y.Doc, deletedIds: string[]): void {
  const deletedSet = new Set(deletedIds);
  const toDetach: Array<{ m: Y.Map<unknown>; end: 'from' | 'to' }> = [];

  for (const [, m] of objectsMap(doc).entries()) {
    if (m.get('type') !== OBJECT_TYPE_CONNECTOR) continue;

    for (const end of ['from', 'to'] as const) {
      const raw = m.get(end);
      const ep = deserializeEndpoint(raw);
      if (ep && ep.kind === 'attached' && deletedSet.has(ep.objectId)) {
        toDetach.push({ m, end });
      }
    }
  }

  for (const { m, end } of toDetach) {
    const ep = deserializeEndpoint(m.get(end))!;
    // The fallback point is where the connector was attached
    if (ep.kind === 'attached') {
      m.set(end, serializeEndpoint({ kind: 'free', x: ep.fallback.x, y: ep.fallback.y }));
    }
  }
}

// --- Endpoint serialization (Y.Map stores plain values) ---

function serializeEndpoint(ep: Endpoint): Record<string, unknown> {
  if (ep.kind === 'attached') {
    return { kind: 'attached', objectId: ep.objectId, fx: ep.fallback.x, fy: ep.fallback.y };
  }
  return { kind: 'free', x: ep.x, y: ep.y };
}

function deserializeEndpoint(raw: unknown): Endpoint | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (o.kind === 'attached' && typeof o.objectId === 'string' && isFiniteNumber(o.fx) && isFiniteNumber(o.fy)) {
    return { kind: 'attached', objectId: o.objectId, fallback: { x: o.fx as number, y: o.fy as number } };
  }
  if (o.kind === 'free' && isFiniteNumber(o.x) && isFiniteNumber(o.y)) {
    return { kind: 'free', x: o.x as number, y: o.y as number };
  }
  return null;
}

/**
 * Read connector snapshots from the doc. Used by board-model's objects().
 * Builds its own rects map from the raw objects map to avoid circular
 * dependency with objects().
 */
export function readConnectorSnaps(doc: Y.Doc): Array<{ id: string; snap: import('../geometry/connector-geometry').ConnectorSnap }> {
  const out: Array<{ id: string; snap: import('../geometry/connector-geometry').ConnectorSnap }> = [];

  // Build rects map directly from the objects map (avoids calling objects()).
  const rects = new Map<string, Rect>();
  for (const [id, m] of objectsMap(doc).entries()) {
    const x = m.get('x');
    const y = m.get('y');
    if (!isFiniteNumber(x) || !isFiniteNumber(y)) continue;
    const w = m.get('width');
    const h = m.get('height');
    const width = isFiniteNumber(w) ? w : 200; // STICKY_SIZE_WORLD fallback
    const height = isFiniteNumber(h) ? h : 200;
    rects.set(id, { x, y, width, height });
  }

  for (const [id, m] of objectsMap(doc).entries()) {
    if (m.get('type') !== OBJECT_TYPE_CONNECTOR) continue;
    const z = m.get('z');
    if (!isFiniteNumber(z)) continue;

    const from = deserializeEndpoint(m.get('from'));
    const to = deserializeEndpoint(m.get('to'));
    if (!from || !to) continue;

    const c: import('../geometry/connector-geometry').ConnectorSnap = {
      id,
      type: 'connector',
      x: 0,
      y: 0,
      z,
      width: 0,
      height: 0,
      from,
      to,
    };

    const { from: fp, to: tp } = resolveEndpoints(c, rects);
    const bbox = connectorBBox(fp, tp);
    c.x = bbox.x;
    c.y = bbox.y;
    c.width = bbox.width;
    c.height = bbox.height;

    out.push({ id, snap: c });
  }
  return out;
}
