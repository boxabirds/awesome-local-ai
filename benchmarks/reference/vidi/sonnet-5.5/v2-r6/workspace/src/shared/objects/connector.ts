import * as Y from 'yjs';
import { LOCAL_ORIGIN, objectBounds, snapshot, type ConnectorSnapshot } from '../board-model';
import { CONNECTOR_MIN_LENGTH_WORLD } from '../config';
import type { Rect } from '../geometry';
import { resolveEndpoints, type Endpoint } from '../geometry/connector-geometry';

export type { Endpoint };
export type ConnectorSnap = ConnectorSnapshot;

function objectsOf(doc: Y.Doc): Y.Map<unknown> {
  return doc.getMap('objects') as Y.Map<unknown>;
}

function connectorMap(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  const m = objectsOf(doc).get(id);
  return m instanceof Y.Map && m.get('type') === 'connector' ? m : undefined;
}

/** Rectangles of everything an arrow can attach to (every object but arrows). */
function targetRects(doc: Y.Doc): Map<string, Rect> {
  const rects = new Map<string, Rect>();
  for (const o of snapshot(doc)) if (o.type !== 'connector') rects.set(o.id, objectBounds(o));
  return rects;
}

const validEndpoint = (e: Endpoint): boolean => (e.kind === 'free'
  ? Number.isFinite(e.x) && Number.isFinite(e.y)
  : typeof e.objectId === 'string' && Number.isFinite(e.fallback.x) && Number.isFinite(e.fallback.y));

/**
 * Attached ends remember the side anchor they resolve to now; it is only used if the target vanishes
 * (a concurrent delete). A target missing already keeps the caller's fallback.
 */
function withFallbacks(from: Endpoint, to: Endpoint, rects: ReadonlyMap<string, Rect>): { from: Endpoint; to: Endpoint; length: number } {
  const ends = resolveEndpoints({ from, to }, rects);
  const fix = (e: Endpoint, p: { x: number; y: number }): Endpoint => (
    e.kind === 'attached' && rects.has(e.objectId) ? { kind: 'attached', objectId: e.objectId, fallback: { x: p.x, y: p.y } } : e);
  return { from: fix(from, ends.from), to: fix(to, ends.to), length: Math.hypot(ends.to.x - ends.from.x, ends.to.y - ends.from.y) };
}

function maxZ(doc: Y.Doc): number {
  let z = 0;
  objectsOf(doc).forEach((o) => {
    const v = o instanceof Y.Map ? o.get('z') : 0;
    if (typeof v === 'number' && Number.isFinite(v)) z = Math.max(z, v);
  });
  return z;
}

/**
 * Creates an arrow. Null (nothing written) for non-finite points, both ends on the same object, or a
 * resolved length below CONNECTOR_MIN_LENGTH_WORLD. An attached end whose object is already gone is kept
 * and drawn at its fallback point.
 */
export function createConnector(doc: Y.Doc, from: Endpoint, to: Endpoint, by: string): string | null {
  if (!validEndpoint(from) || !validEndpoint(to)) return null;
  if (from.kind === 'attached' && to.kind === 'attached' && from.objectId === to.objectId) return null;
  const r = withFallbacks(from, to, targetRects(doc));
  if (r.length < CONNECTOR_MIN_LENGTH_WORLD) return null;
  const id = crypto.randomUUID();
  const z = maxZ(doc) + 1;
  doc.transact(() => {
    const m = new Y.Map<unknown>();
    objectsOf(doc).set(id, m);
    m.set('type', 'connector');
    m.set('x', 0);
    m.set('y', 0);
    m.set('width', 0);
    m.set('height', 0);
    m.set('from', r.from);
    m.set('to', r.to);
    m.set('z', z);
    m.set('createdAt', Date.now());
    m.set('createdBy', by);
  }, LOCAL_ORIGIN);
  return id;
}

const asEndpoint = (v: unknown): Endpoint | undefined => {
  const e = v as Endpoint | undefined;
  return e && (e.kind === 'attached' || e.kind === 'free') ? e : undefined;
};

/** False (nothing written) for a stale id, non-finite points, or attaching to the object at the other end. */
export function setConnectorEndpoint(doc: Y.Doc, id: string, end: 'from' | 'to', e: Endpoint): boolean {
  const m = connectorMap(doc, id);
  if (!m || !validEndpoint(e)) return false;
  const otherKey = end === 'from' ? 'to' : 'from';
  const other = asEndpoint(m.get(otherKey));
  if (!other) return false;
  if (e.kind === 'attached' && (other.kind === 'attached' && other.objectId === e.objectId || e.objectId === id)) return false;
  const rects = targetRects(doc);
  const r = end === 'from' ? withFallbacks(e, other, rects) : withFallbacks(other, e, rects);
  doc.transact(() => {
    m.set('from', r.from);
    m.set('to', r.to);
  }, LOCAL_ORIGIN);
  return true;
}

/** Inside the caller's transaction: ends attached to a deleted object become free where they were attached. */
export function detachConnectorsTo(doc: Y.Doc, deletedIds: readonly string[]): void {
  const gone = new Set(deletedIds);
  const rects = targetRects(doc);
  objectsOf(doc).forEach((m) => {
    if (!(m instanceof Y.Map) || m.get('type') !== 'connector') return;
    const from = asEndpoint(m.get('from'));
    const to = asEndpoint(m.get('to'));
    if (!from || !to) return;
    const hit = (e: Endpoint) => e.kind === 'attached' && gone.has(e.objectId);
    if (!hit(from) && !hit(to)) return;
    const ends = resolveEndpoints({ from, to }, rects);
    if (hit(from)) m.set('from', { kind: 'free', x: ends.from.x, y: ends.from.y });
    if (hit(to)) m.set('to', { kind: 'free', x: ends.to.x, y: ends.to.y });
  });
}
