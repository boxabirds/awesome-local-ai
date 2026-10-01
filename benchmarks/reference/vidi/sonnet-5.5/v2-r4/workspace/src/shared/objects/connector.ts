import * as Y from 'yjs';
import { CONNECTOR_MIN_LENGTH_WORLD } from '../config';
import { LOCAL_ORIGIN, objectRects, snapshot, type ObjectSnapshot } from '../board-model';
import type { Point, Rect } from '../geometry';
import { nearestSide, rectCenter, resolveEndpoints, sideAnchor } from '../geometry/connector-geometry';

export type Endpoint = { kind: 'attached'; objectId: string; fallback: Point } | { kind: 'free'; x: number; y: number };

export interface ConnectorSnap extends ObjectSnapshot {
  type: 'connector';
  from: Endpoint;
  to: Endpoint;
  /** The drawn line, resolved against the object rectangles when the snapshot was taken. */
  ends: { from: Point; to: Point };
}

export function isConnector(o: ObjectSnapshot): o is ConnectorSnap {
  return o.type === 'connector';
}

function objects(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects') as Y.Map<Y.Map<unknown>>;
}

function maxZ(doc: Y.Doc): number {
  let max = 0;
  objects(doc).forEach((o) => {
    const z = o.get('z');
    if (typeof z === 'number' && Number.isFinite(z)) max = Math.max(max, z);
  });
  return max;
}

const finite = (...v: number[]) => v.every((n) => Number.isFinite(n));

/** Reads a stored endpoint; anything malformed becomes a free end at the origin so the arrow still renders. */
export function parseEndpoint(v: unknown): Endpoint {
  const e = v as Partial<Endpoint> | null | undefined;
  if (e && e.kind === 'attached' && typeof e.objectId === 'string') {
    const f = (e as { fallback?: Point }).fallback;
    return { kind: 'attached', objectId: e.objectId, fallback: f && finite(f.x, f.y) ? { x: f.x, y: f.y } : { x: 0, y: 0 } };
  }
  if (e && e.kind === 'free' && finite(e.x as number, e.y as number)) return { kind: 'free', x: e.x as number, y: e.y as number };
  return { kind: 'free', x: 0, y: 0 };
}

function validEndpoint(e: Endpoint): boolean {
  if (!e || typeof e !== 'object') return false;
  if (e.kind === 'free') return finite(e.x, e.y);
  return e.kind === 'attached' && typeof e.objectId === 'string' && e.objectId !== '' && !!e.fallback && finite(e.fallback.x, e.fallback.y);
}

/** The anchor currently used by `e`, or its fallback when the target is not in `rects`. Attached ends get a refreshed fallback. */
function withFallback(e: Endpoint, other: Endpoint, rects: ReadonlyMap<string, Rect>): Endpoint {
  if (e.kind === 'free') return e;
  const r = rects.get(e.objectId);
  if (!r) return e;
  const o = other.kind === 'free' ? { x: other.x, y: other.y } : rects.get(other.objectId) ? rectCenter(rects.get(other.objectId)!) : other.fallback;
  return { kind: 'attached', objectId: e.objectId, fallback: sideAnchor(r, nearestSide(r, o)) };
}

function endpointsToSame(a: Endpoint, b: Endpoint): boolean {
  return a.kind === 'attached' && b.kind === 'attached' && a.objectId === b.objectId;
}

/**
 * Null (nothing written) when both ends attach to the same object, the resolved length is below
 * CONNECTOR_MIN_LENGTH_WORLD or a number is not finite. A target missing from the doc is still accepted:
 * it is drawn at its fallback (the concurrent-delete race).
 */
export function createConnector(doc: Y.Doc, from: Endpoint, to: Endpoint, by: string): string | null {
  if (!validEndpoint(from) || !validEndpoint(to) || endpointsToSame(from, to)) return null;
  const rects = objectRects(doc);
  const f = withFallback(from, to, rects);
  const t = withFallback(to, from, rects);
  const ends = resolveEndpoints({ from: f, to: t }, rects);
  if (Math.hypot(ends.from.x - ends.to.x, ends.from.y - ends.to.y) < CONNECTOR_MIN_LENGTH_WORLD) return null;
  const id = crypto.randomUUID();
  doc.transact(() => {
    const obj = new Y.Map<unknown>();
    objects(doc).set(id, obj);
    obj.set('type', 'connector');
    obj.set('x', 0);
    obj.set('y', 0);
    obj.set('width', 0);
    obj.set('height', 0);
    obj.set('from', f);
    obj.set('to', t);
    obj.set('z', maxZ(doc) + 1);
    obj.set('createdAt', Date.now());
    obj.set('createdBy', by);
  }, LOCAL_ORIGIN);
  return id;
}

/** False (nothing written) for a stale id, a non-finite point, or attaching to the object at the opposite end. */
export function setConnectorEndpoint(doc: Y.Doc, id: string, end: 'from' | 'to', e: Endpoint): boolean {
  const obj = objects(doc).get(id);
  if (!obj || obj.get('type') !== 'connector' || !validEndpoint(e)) return false;
  const other = parseEndpoint(obj.get(end === 'from' ? 'to' : 'from'));
  if (endpointsToSame(e, other)) return false;
  const rects = objectRects(doc);
  const next = withFallback(e, other, rects);
  doc.transact(() => obj.set(end, next), LOCAL_ORIGIN);
  return true;
}

/** Inside the caller's transaction: every end attached to a deleted id becomes free at the point where it was drawn. */
export function detachConnectorsTo(doc: Y.Doc, deletedIds: string[]): void {
  const gone = new Set(deletedIds);
  const snap = snapshot(doc);
  const rects = objectRects(doc);
  for (const o of snap) {
    if (!isConnector(o) || gone.has(o.id)) continue;
    const touches = (e: Endpoint) => e.kind === 'attached' && gone.has(e.objectId);
    if (!touches(o.from) && !touches(o.to)) continue;
    const ends = resolveEndpoints(o, rects);
    const obj = objects(doc).get(o.id);
    if (!obj) continue;
    if (touches(o.from)) obj.set('from', { kind: 'free', x: ends.from.x, y: ends.from.y });
    if (touches(o.to)) obj.set('to', { kind: 'free', x: ends.to.x, y: ends.to.y });
  }
}
