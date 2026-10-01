import * as Y from 'yjs';
import { CONNECTOR_MIN_LENGTH_WORLD, STICKY_SIZE_WORLD } from '../config';
import { hasObject, LOCAL_ORIGIN } from '../board-model';
import {
  centreOf, nearestSide, resolveEndpoints, sideAnchor, type Endpoint,
} from '../geometry/connector-geometry';
import type { Point, Rect } from '../geometry';

export type { Endpoint, ConnectorSnap } from '../geometry/connector-geometry';

const objectsOf = (doc: Y.Doc) => doc.getMap('objects') as Y.Map<Y.Map<unknown>>;

function connectorObject(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  const obj = objectsOf(doc).get(id);
  return obj instanceof Y.Map && obj.get('type') === 'connector' ? obj : undefined;
}

const finite = (...n: number[]) => n.every(Number.isFinite);

export function parseEndpoint(v: unknown): Endpoint | undefined {
  if (typeof v !== 'object' || v === null) return undefined;
  const e = v as Record<string, unknown>;
  if (e.kind === 'free' && typeof e.x === 'number' && typeof e.y === 'number' && finite(e.x, e.y)) {
    return { kind: 'free', x: e.x, y: e.y };
  }
  const fb = e.fallback as Record<string, unknown> | undefined;
  if (e.kind === 'attached' && typeof e.objectId === 'string' && fb && typeof fb.x === 'number'
    && typeof fb.y === 'number' && finite(fb.x, fb.y)) {
    return { kind: 'attached', objectId: e.objectId, fallback: { x: fb.x, y: fb.y } };
  }
  return undefined;
}

/** Rectangles of every non-connector object currently in the doc. */
export function readRects(doc: Y.Doc): Map<string, Rect> {
  const rects = new Map<string, Rect>();
  objectsOf(doc).forEach((obj, id) => {
    if (!(obj instanceof Y.Map) || obj.get('type') === 'connector') return;
    const x = obj.get('x');
    const y = obj.get('y');
    if (typeof x !== 'number' || typeof y !== 'number') return;
    const w = obj.get('width');
    const h = obj.get('height');
    rects.set(id, {
      x, y,
      width: typeof w === 'number' && w > 0 ? w : STICKY_SIZE_WORLD,
      height: typeof h === 'number' && h > 0 ? h : STICKY_SIZE_WORLD,
    });
  });
  return rects;
}

/** Re-anchors an attached end to the current nearest side of its target, when the target exists. */
function withFallback(e: Endpoint, other: Endpoint, rects: ReadonlyMap<string, Rect>): Endpoint {
  if (e.kind === 'free') return e;
  const r = rects.get(e.objectId);
  if (!r) return e;
  const otherRect = other.kind === 'attached' ? rects.get(other.objectId) : undefined;
  const toward = other.kind === 'free' ? { x: other.x, y: other.y }
    : otherRect ? centreOf(otherRect) : other.fallback;
  return { ...e, fallback: sideAnchor(r, nearestSide(r, toward)) };
}

const valid = (e: Endpoint) => parseEndpoint(e) !== undefined;

/** Null (nothing written) for an invalid end, a self-connection or an arrow shorter than the minimum length. */
export function createConnector(doc: Y.Doc, from: Endpoint, to: Endpoint, by: string): string | null {
  if (!valid(from) || !valid(to)) return null;
  if (from.kind === 'attached' && to.kind === 'attached' && from.objectId === to.objectId) return null;
  const rects = readRects(doc);
  const f = withFallback(from, to, rects);
  const t = withFallback(to, from, rects);
  const ends = resolveEndpoints({ from: f, to: t }, rects);
  if (Math.hypot(ends.to.x - ends.from.x, ends.to.y - ends.from.y) < CONNECTOR_MIN_LENGTH_WORLD) return null;
  const id = crypto.randomUUID();
  doc.transact(() => {
    let max = 0;
    objectsOf(doc).forEach((o) => {
      const z = o instanceof Y.Map ? o.get('z') : 0;
      if (typeof z === 'number') max = Math.max(max, z);
    });
    const obj = new Y.Map<unknown>();
    objectsOf(doc).set(id, obj);
    obj.set('type', 'connector');
    obj.set('x', 0); obj.set('y', 0); obj.set('width', 0); obj.set('height', 0);
    obj.set('z', max + 1);
    obj.set('createdAt', Date.now());
    obj.set('createdBy', by);
    obj.set('from', f);
    obj.set('to', t);
  }, LOCAL_ORIGIN);
  return id;
}

/** False (nothing written) for a stale connector or target, a non-finite point, or the object at the other end. */
export function setConnectorEndpoint(doc: Y.Doc, id: string, end: 'from' | 'to', e: Endpoint): boolean {
  const obj = connectorObject(doc, id);
  if (!obj || !valid(e)) return false;
  const otherKey = end === 'from' ? 'to' : 'from';
  const other = parseEndpoint(obj.get(otherKey));
  if (!other) return false;
  if (e.kind === 'attached') {
    if (other.kind === 'attached' && other.objectId === e.objectId) return false;
    if (e.objectId === id || !hasObject(doc, e.objectId)) return false;
  }
  const rects = readRects(doc);
  const next = withFallback(e, other, rects);
  doc.transact(() => {
    obj.set(end, next);
    // The other end may switch sides now that this end moved; keep its stored anchor current.
    if (other.kind === 'attached') obj.set(otherKey, withFallback(other, next, rects));
  }, LOCAL_ORIGIN);
  return true;
}

/** Call inside the caller's transaction, before the objects are removed. */
export function detachConnectorsTo(doc: Y.Doc, deletedIds: readonly string[]): void {
  const gone = new Set(deletedIds);
  const rects = readRects(doc);
  objectsOf(doc).forEach((obj, id) => {
    if (!(obj instanceof Y.Map) || obj.get('type') !== 'connector' || gone.has(id)) return;
    const from = parseEndpoint(obj.get('from'));
    const to = parseEndpoint(obj.get('to'));
    if (!from || !to) return;
    const hit = (e: Endpoint) => e.kind === 'attached' && gone.has(e.objectId);
    if (!hit(from) && !hit(to)) return;
    const at = resolveEndpoints({ from, to }, rects);
    const free = (p: Point): Endpoint => ({ kind: 'free', x: p.x, y: p.y });
    if (hit(from)) obj.set('from', free(at.from));
    if (hit(to)) obj.set('to', free(at.to));
  });
}
