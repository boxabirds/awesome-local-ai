// Story 10: the `connector` object type's model layer. Endpoint creation,
// re-attachment and detach-on-delete. Attached ends store no side: the anchor
// is recomputed from the live rects every render (connector-geometry), so
// arrows follow moves by anyone. `fallback` is the anchor captured at write
// time, used only when the target is concurrently gone (orphaned).

import * as Y from 'yjs';
import { CONNECTOR_MIN_LENGTH_WORLD, STICKY_SIZE_WORLD } from '../config';
import { LOCAL_ORIGIN } from '../board-model';
import type { Rect } from '../geometry';
import {
  aimReference,
  nearestSide,
  resolveEndpoints,
  sideAnchor,
  type Endpoint,
} from '../geometry/connector-geometry';

export type { Endpoint } from '../geometry/connector-geometry';

function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>('objects');
}

function connectorMap(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  const obj = objectsMap(doc).get(id);
  if (!obj || obj.get('type') !== 'connector') return undefined;
  return obj;
}

function finite(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

// Live rects of every attachable object, for side/anchor computation.
function currentRects(doc: Y.Doc): Map<string, Rect> {
  const rects = new Map<string, Rect>();
  for (const [id, obj] of objectsMap(doc)) {
    const type = obj.get('type');
    if (typeof type !== 'string' || type === 'connector') continue;
    const x = obj.get('x');
    const y = obj.get('y');
    const width = obj.get('width');
    const height = obj.get('height');
    rects.set(id, {
      x: finite(x) ? x : 0,
      y: finite(y) ? y : 0,
      width: finite(width) ? width : STICKY_SIZE_WORLD,
      height: finite(height) ? height : STICKY_SIZE_WORLD,
    });
  }
  return rects;
}

// The anchor a given (attached) end should carry as its fallback, aimed at the
// other end's reference point.
function anchorFor(e: Endpoint, other: Endpoint, rects: ReadonlyMap<string, Rect>): Point2 {
  if (e.kind === 'free') return { x: e.x, y: e.y };
  const r = rects.get(e.objectId);
  if (!r) return e.fallback;
  return sideAnchor(r, nearestSide(r, aimReference(other, rects)));
}

interface Point2 {
  x: number;
  y: number;
}

function endpointValid(e: Endpoint): boolean {
  if (e.kind === 'free') return finite(e.x) && finite(e.y);
  return typeof e.objectId === 'string' && finite(e.fallback?.x) && finite(e.fallback?.y);
}

function endpointAttachedTo(e: Endpoint, objectId: string): boolean {
  return e.kind === 'attached' && e.objectId === objectId;
}

function maxZ(objects: Y.Map<Y.Map<unknown>>): number {
  let max = 0;
  for (const obj of objects.values()) {
    const z = obj.get('z');
    if (typeof z === 'number' && z > max) max = z;
  }
  return max;
}

// Creates an arrow between two endpoints. Rejects (no write) when both ends
// attach to the same object, when the resolved length is below
// CONNECTOR_MIN_LENGTH_WORLD, or when an endpoint is malformed. Each attached
// end stores a fallback = its current side anchor. One LOCAL_ORIGIN transaction.
export function createConnector(doc: Y.Doc, from: Endpoint, to: Endpoint, by: string): string | null {
  if (!endpointValid(from) || !endpointValid(to)) return null;
  if (from.kind === 'attached' && to.kind === 'attached' && from.objectId === to.objectId) {
    return null;
  }

  const rects = currentRects(doc);
  const ends = resolveEndpoints({ from, to }, rects);
  const length = Math.hypot(ends.to.x - ends.from.x, ends.to.y - ends.from.y);
  if (!(length >= CONNECTOR_MIN_LENGTH_WORLD)) return null;

  const storedFrom: Endpoint =
    from.kind === 'attached'
      ? { kind: 'attached', objectId: from.objectId, fallback: anchorFor(from, to, rects) }
      : { kind: 'free', x: from.x, y: from.y };
  const storedTo: Endpoint =
    to.kind === 'attached'
      ? { kind: 'attached', objectId: to.objectId, fallback: anchorFor(to, from, rects) }
      : { kind: 'free', x: to.x, y: to.y };

  const objects = objectsMap(doc);
  const z = maxZ(objects) + 1;
  const id = crypto.randomUUID();
  doc.transact(() => {
    const obj = new Y.Map<unknown>();
    obj.set('type', 'connector');
    obj.set('from', storedFrom);
    obj.set('to', storedTo);
    obj.set('x', 0);
    obj.set('y', 0);
    obj.set('width', 0);
    obj.set('height', 0);
    obj.set('z', z);
    obj.set('createdAt', Date.now());
    obj.set('createdBy', by);
    objects.set(id, obj);
  }, LOCAL_ORIGIN);
  return id;
}

// Re-points one end of a connector (handle drag). Rejects a stale id, a
// malformed endpoint, or attaching an end to the object at the opposite end.
export function setConnectorEndpoint(
  doc: Y.Doc,
  id: string,
  end: 'from' | 'to',
  e: Endpoint,
): boolean {
  const obj = connectorMap(doc, id);
  if (!obj) return false;
  if (!endpointValid(e)) return false;

  const otherKey = end === 'from' ? 'to' : 'from';
  const other = obj.get(otherKey) as Endpoint | undefined;
  if (e.kind === 'attached' && other && endpointAttachedTo(other, e.objectId)) {
    return false; // must not attach both ends to the same object
  }

  const rects = currentRects(doc);
  const stored: Endpoint =
    e.kind === 'attached'
      ? { kind: 'attached', objectId: e.objectId, fallback: anchorFor(e, other ?? e, rects) }
      : { kind: 'free', x: e.x, y: e.y };
  doc.transact(() => {
    obj.set(end, stored);
  }, LOCAL_ORIGIN);
  return true;
}

// Inside the caller's (deleteObjects) transaction: every connector end attached
// to a deleted id becomes free, pinned at the anchor where it currently sits,
// so the arrow survives with a free end. No nested transaction.
export function detachConnectorsTo(doc: Y.Doc, deletedIds: string[]): void {
  if (deletedIds.length === 0) return;
  const doomed = new Set(deletedIds);
  const rects = currentRects(doc);
  for (const obj of objectsMap(doc).values()) {
    if (obj.get('type') !== 'connector') continue;
    const from = obj.get('from') as Endpoint | undefined;
    const to = obj.get('to') as Endpoint | undefined;
    if (from && from.kind === 'attached' && doomed.has(from.objectId)) {
      const anchor = anchorFor(from, to ?? from, rects);
      obj.set('from', { kind: 'free', x: anchor.x, y: anchor.y });
    }
    if (to && to.kind === 'attached' && doomed.has(to.objectId)) {
      const anchor = anchorFor(to, from ?? to, rects);
      obj.set('to', { kind: 'free', x: anchor.x, y: anchor.y });
    }
  }
}
