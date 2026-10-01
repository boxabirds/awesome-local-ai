import * as Y from 'yjs';
import { LOCAL_ORIGIN, maxZ, objectBounds, objectsOf, snapshot } from '../board-model';
import type { ObjectSnapshot } from '../board-model';
import { CONNECTOR_MIN_LENGTH_WORLD } from '../config';
import { nearestSide, rectCentre, resolveEndpoints, sideAnchor } from '../geometry/connector-geometry';
import type { Point, Rect } from '../geometry';

export type Endpoint =
  | { kind: 'attached'; objectId: string; fallback: Point }
  | { kind: 'free'; x: number; y: number };

export interface ConnectorSnap extends ObjectSnapshot {
  type: 'connector';
  from: Endpoint;
  to: Endpoint;
  /** Where each end is drawn right now (derived; equals the bounding box corners). */
  ends: { from: Point; to: Point };
}

/** Rects of every object arrows can attach to (everything except arrows). */
export function connectableRects(snap: readonly ObjectSnapshot[]): Map<string, Rect> {
  const rects = new Map<string, Rect>();
  for (const o of snap) if (o.type !== 'connector') rects.set(o.id, objectBounds(o));
  return rects;
}

/** The topmost object under `p`: `rects` is in stacking order (back to front), as `connectableRects` of a snapshot gives. */
export function objectAt(rects: ReadonlyMap<string, Rect>, p: Point): string | null {
  let hit: string | null = null;
  for (const [id, r] of rects) {
    if (p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height) hit = id;
  }
  return hit;
}

function finitePoint(p: Point): boolean {
  return Number.isFinite(p.x) && Number.isFinite(p.y);
}

function validEndpoint(e: Endpoint): boolean {
  if (e.kind === 'free') return finitePoint(e);
  return e.kind === 'attached' && typeof e.objectId === 'string' && finitePoint(e.fallback);
}

/** Stored form of an endpoint: an attached end's fallback is the anchor it has now, when the target exists. */
function normalize(e: Endpoint, other: Endpoint, rects: ReadonlyMap<string, Rect>): Endpoint {
  if (e.kind === 'free') return { kind: 'free', x: e.x, y: e.y };
  const r = rects.get(e.objectId);
  if (!r) return { kind: 'attached', objectId: e.objectId, fallback: { x: e.fallback.x, y: e.fallback.y } };
  const toward = other.kind === 'free' ? other : (rects.get(other.objectId) ? rectCentre(rects.get(other.objectId) as Rect) : other.fallback);
  return { kind: 'attached', objectId: e.objectId, fallback: sideAnchor(r, nearestSide(r, toward)) };
}

function connectorObj(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  const obj = objectsOf(doc).get(id);
  return obj && obj.get('type') === 'connector' ? obj : undefined;
}

/**
 * Creates an arrow. Null (and no transaction) when both ends attach to the same object, an end is invalid, or
 * the arrow would be shorter than the minimum length. An attached end whose object is already gone is still
 * stored (drawn at its fallback).
 */
export function createConnector(doc: Y.Doc, from: Endpoint, to: Endpoint, by: string): string | null {
  if (!validEndpoint(from) || !validEndpoint(to)) return null;
  if (from.kind === 'attached' && to.kind === 'attached' && from.objectId === to.objectId) return null;
  const rects = connectableRects(snapshot(doc));
  const a = normalize(from, to, rects);
  const b = normalize(to, from, rects);
  const ends = resolveEndpoints({ from: a, to: b }, rects);
  if (Math.hypot(ends.to.x - ends.from.x, ends.to.y - ends.from.y) < CONNECTOR_MIN_LENGTH_WORLD) return null;
  const id = crypto.randomUUID();
  doc.transact(() => {
    const obj = new Y.Map<unknown>();
    objectsOf(doc).set(id, obj);
    obj.set('type', 'connector');
    obj.set('x', 0);
    obj.set('y', 0);
    obj.set('width', 0);
    obj.set('height', 0);
    obj.set('from', a);
    obj.set('to', b);
    obj.set('z', maxZ(doc) + 1);
    obj.set('createdAt', Date.now());
    obj.set('createdBy', by);
  }, LOCAL_ORIGIN);
  return id;
}

/** Re-attaches or detaches one end. False (no transaction) for a stale id, bad point, or attaching to the object at the other end. */
export function setConnectorEndpoint(doc: Y.Doc, id: string, end: 'from' | 'to', e: Endpoint): boolean {
  const obj = connectorObj(doc, id);
  if (!obj || !validEndpoint(e)) return false;
  const otherKey = end === 'from' ? 'to' : 'from';
  const other = obj.get(otherKey) as Endpoint;
  if (e.kind === 'attached' && other.kind === 'attached' && other.objectId === e.objectId) return false;
  if (e.kind === 'attached' && !objectsOf(doc).has(e.objectId)) return false;
  const rects = connectableRects(snapshot(doc));
  const next = normalize(e, other, rects);
  if (JSON.stringify(obj.get(end)) === JSON.stringify(next)) return false;
  doc.transact(() => obj.set(end, next), LOCAL_ORIGIN);
  return true;
}

/** Inside the caller's transaction: ends attached to a deleted object become free at the point where they were attached. */
export function detachConnectorsTo(doc: Y.Doc, deletedIds: string[]): void {
  const deleted = new Set(deletedIds);
  const snap = snapshot(doc);
  const rects = connectableRects(snap);
  for (const o of snap) {
    if (o.type !== 'connector' || deleted.has(o.id)) continue;
    const c = o as ConnectorSnap;
    const obj = connectorObj(doc, c.id);
    if (!obj) continue;
    const ends = resolveEndpoints(c, rects);
    for (const key of ['from', 'to'] as const) {
      const e = c[key];
      if (e.kind === 'attached' && deleted.has(e.objectId)) obj.set(key, { kind: 'free', x: ends[key].x, y: ends[key].y });
    }
  }
}

/** Moves an arrow by (dx, dy): free ends shift, attached ends stay on their objects. Writes inside the caller's transaction. */
export function shiftFreeEnds(doc: Y.Doc, id: string, dx: number, dy: number): boolean {
  const obj = connectorObj(doc, id);
  if (!obj) return false;
  let changed = false;
  for (const key of ['from', 'to'] as const) {
    const e = obj.get(key) as Endpoint;
    if (e.kind === 'free') {
      obj.set(key, { kind: 'free', x: e.x + dx, y: e.y + dy });
      changed = true;
    }
  }
  return changed;
}
