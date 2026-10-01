import * as Y from 'yjs';
import { CONNECTOR_MIN_LENGTH_WORLD } from '../config';
import { LOCAL_ORIGIN } from '../board-model';
import type { Point } from '../geometry';
import type { Rect } from '../geometry';

export type Endpoint =
  | { kind: 'attached'; objectId: string; fallback: Point }
  | { kind: 'free'; x: number; y: number };

function getObjects(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects');
}

function isFinitePoint(x: number, y: number): boolean {
  return Number.isFinite(x) && Number.isFinite(y);
}

function getMaxZ(doc: Y.Doc): number {
  let maxZ = 0;
  getObjects(doc).forEach((obj) => {
    const z = obj.get('z');
    if (typeof z === 'number' && z > maxZ) maxZ = z;
  });
  return maxZ;
}

function getObjRect(doc: Y.Doc, id: string): Rect | null {
  const obj = getObjects(doc).get(id);
  if (!obj) return null;
  const x = obj.get('x') as number;
  const y = obj.get('y') as number;
  const w = (obj.get('width') as number | undefined) ?? 200; // default for stickies
  const h = (obj.get('height') as number | undefined) ?? 200;
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(w) || !Number.isFinite(h)) return null;
  return { x, y, width: w, height: h };
}

function endpointLength(from: Endpoint, to: Endpoint, doc: Y.Doc): number {
  // Resolve to points for length calculation
  const fromPt = resolveToPoint(from, doc);
  const toPt = resolveToPoint(to, doc);
  const dx = toPt.x - fromPt.x;
  const dy = toPt.y - fromPt.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function resolveToPoint(ep: Endpoint, doc: Y.Doc): Point {
  if (ep.kind === 'free') return { x: ep.x, y: ep.y };
  const rect = getObjRect(doc, ep.objectId);
  if (!rect) return ep.fallback;
  // Use centre for length calculation (exact side doesn't matter for length check)
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

function storeEndpoint(map: Y.Map<unknown>, key: string, ep: Endpoint): void {
  if (ep.kind === 'attached') {
    const m = new Y.Map<unknown>();
    m.set('kind', 'attached');
    m.set('objectId', ep.objectId);
    const fb = new Y.Map<unknown>();
    fb.set('x', ep.fallback.x);
    fb.set('y', ep.fallback.y);
    m.set('fallback', fb);
    map.set(key, m);
  } else {
    const m = new Y.Map<unknown>();
    m.set('kind', 'free');
    m.set('x', ep.x);
    m.set('y', ep.y);
    map.set(key, m);
  }
}

function readEndpoint(map: Y.Map<unknown>, key: string): Endpoint | null {
  const m = map.get(key);
  if (!(m instanceof Y.Map)) return null;
  const kind = m.get('kind');
  if (kind === 'attached') {
    const objectId = m.get('objectId') as string;
    const fb = m.get('fallback') as Y.Map<unknown> | undefined;
    const fallback: Point = fb
      ? { x: fb.get('x') as number, y: fb.get('y') as number }
      : { x: 0, y: 0 };
    return { kind: 'attached', objectId, fallback };
  } else if (kind === 'free') {
    return { kind: 'free', x: m.get('x') as number, y: m.get('y') as number };
  }
  return null;
}

/**
 * Creates a connector between two endpoints. Returns null if:
 * - both ends attach to the same object
 * - the resolved length is less than CONNECTOR_MIN_LENGTH_WORLD
 * - endpoints have non-finite coordinates
 */
export function createConnector(doc: Y.Doc, from: Endpoint, to: Endpoint, by: string): string | null {
  // Validate non-finite points
  if (from.kind === 'free' && !isFinitePoint(from.x, from.y)) return null;
  if (to.kind === 'free' && !isFinitePoint(to.x, to.y)) return null;

  // Reject self-connection
  if (from.kind === 'attached' && to.kind === 'attached' && from.objectId === to.objectId) {
    return null;
  }

  // Check minimum length
  const len = endpointLength(from, to, doc);
  if (len < CONNECTOR_MIN_LENGTH_WORLD) return null;

  const id = crypto.randomUUID();
  const z = getMaxZ(doc) + 1;

  doc.transact(() => {
    const obj = new Y.Map<unknown>();
    obj.set('type', 'connector');
    obj.set('x', 0);
    obj.set('y', 0);
    obj.set('width', 0);
    obj.set('height', 0);
    obj.set('z', z);
    obj.set('createdAt', Date.now());
    obj.set('createdBy', by);
    storeEndpoint(obj, 'from', from);
    storeEndpoint(obj, 'to', to);
    getObjects(doc).set(id, obj);
  }, LOCAL_ORIGIN);

  return id;
}

/**
 * Sets one endpoint of a connector. Returns false if:
 * - the connector id doesn't exist (stale)
 * - the new endpoint attaches to the object at the opposite end
 * - the new endpoint has non-finite coordinates
 */
export function setConnectorEndpoint(doc: Y.Doc, id: string, end: 'from' | 'to', e: Endpoint): boolean {
  const obj = getObjects(doc).get(id);
  if (!obj || obj.get('type') !== 'connector') return false;

  // Validate non-finite
  if (e.kind === 'free' && !isFinitePoint(e.x, e.y)) return false;

  // Check opposite end
  const otherKey = end === 'from' ? 'to' : 'from';
  const otherEp = readEndpoint(obj, otherKey);
  if (otherEp && e.kind === 'attached' && otherEp.kind === 'attached' && otherEp.objectId === e.objectId) {
    return false;
  }

  doc.transact(() => {
    storeEndpoint(obj, end, e);
  }, LOCAL_ORIGIN);

  return true;
}

/**
 * Detaches all connector ends that are attached to any of the deleted ids.
 * Must be called inside an open transaction (the caller's transaction).
 * Each formerly-attached end becomes free at the current anchor point.
 */
export function detachConnectorsTo(doc: Y.Doc, deletedIds: readonly string[]): void {
  if (deletedIds.length === 0) return;
  const idSet = new Set(deletedIds);
  const objects = getObjects(doc);

  objects.forEach((obj) => {
    if (obj.get('type') !== 'connector') return;
    for (const key of ['from', 'to'] as const) {
      const ep = readEndpoint(obj, key);
      if (ep && ep.kind === 'attached' && idSet.has(ep.objectId)) {
        // Convert to free at the current anchor (fallback)
        storeEndpoint(obj, key, { kind: 'free', x: ep.fallback.x, y: ep.fallback.y });
      }
    }
  });
}
