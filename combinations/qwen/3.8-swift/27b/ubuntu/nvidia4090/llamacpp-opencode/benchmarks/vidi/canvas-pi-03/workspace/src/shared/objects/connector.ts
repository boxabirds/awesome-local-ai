/**
 * Story 10: the connector (arrow) object type (connector.model).
 *
 * Schema (one entry per object in the `objects` map):
 *   type: 'connector', x, y, width, height (stored 0 — the bbox is derived
 *   in `allObjects` from the resolved endpoints), z, createdAt, createdBy,
 *   from: Endpoint, to: Endpoint
 *
 * Endpoint = { kind: 'attached', objectId, fallback } | { kind: 'free', x, y }.
 * An attached endpoint stores NO side: the side is recomputed from the live
 * rectangles on every render (resolveEndpoints), so arrows follow moves by
 * anyone without writes; `fallback` (the anchor at attach time) is used only
 * when the target vanished concurrently (connector.target_deleted race).
 *
 * Rejection rules (connector.no_accidental) are evaluated before any write:
 * a self-connection and a resolved length below CONNECTOR_MIN_LENGTH_WORLD
 * create nothing. `detachConnectorsTo` converts attached ends on deleted
 * objects to `free` at the current anchor inside the caller's transaction.
 */
import * as Y from 'yjs';
import { LOCAL_ORIGIN, type ObjectSnapshot } from '../board-model';
import {
  resolveEndpoints,
  sideAnchor,
  nearestSide,
  parseEndpoint,
  type Endpoint,
} from '../geometry/connector-geometry';
import type { Point, Rect } from '../geometry';
import { CONNECTOR_MIN_LENGTH_WORLD } from '../config';

export type { Endpoint } from '../geometry/connector-geometry';

export interface ConnectorSnap extends ObjectSnapshot {
  type: 'connector';
  from: Endpoint;
  to: Endpoint;
}

type ObjectMap = Y.Map<unknown>;

function objectsOf(doc: Y.Doc): Y.Map<ObjectMap> {
  return doc.getMap('objects');
}

function connectorOf(doc: Y.Doc, id: string): ObjectMap | undefined {
  const obj = objectsOf(doc).get(id);
  if (!(obj instanceof Y.Map) || obj.get('type') !== 'connector') return undefined;
  return obj;
}

function isFinitePoint(p: Point): boolean {
  return Number.isFinite(p.x) && Number.isFinite(p.y);
}

function maxZ(objects: Y.Map<ObjectMap>): number {
  let max = 0;
  objects.forEach((obj) => {
    if (!(obj instanceof Y.Map)) return;
    const z = obj.get('z');
    if (typeof z === 'number' && z > max) max = z;
  });
  return max;
}

/** True for a well-formed endpoint value. */
function isValidEndpoint(ep: Endpoint): boolean {
  if (ep.kind === 'free') return isFinitePoint(ep);
  return ep.objectId !== '' && isFinitePoint(ep.fallback);
}

/**
 * Live world rects of every non-connector object in the doc (the attach
 * targets). Connectors' own derived boxes are irrelevant for resolution.
 */
function liveRects(doc: Y.Doc): Map<string, Rect> {
  const rects = new Map<string, Rect>();
  objectsOf(doc).forEach((obj, key) => {
    if (!(obj instanceof Y.Map)) return;
    if (obj.get('type') === 'connector') return;
    const x = obj.get('x');
    const y = obj.get('y');
    if (typeof x !== 'number' || typeof y !== 'number') return;
    const width = obj.get('width');
    const height = obj.get('height');
    rects.set(key as string, {
      x,
      y,
      width: typeof width === 'number' && Number.isFinite(width) ? width : 0,
      height: typeof height === 'number' && Number.isFinite(height) ? height : 0,
    });
  });
  return rects;
}

/**
 * Creates a connector between two endpoints (connector.create_attached /
 * connector.create_free). Returns the new id, or null (no transaction) when
 * - an endpoint is malformed (non-finite point, empty objectId),
 * - both ends attach to the same object (self-connection),
 * - the resolved length is below CONNECTOR_MIN_LENGTH_WORLD.
 */
export function createConnector(doc: Y.Doc, from: Endpoint, to: Endpoint, by: string): string | null {
  if (!isValidEndpoint(from) || !isValidEndpoint(to)) return null;
  if (from.kind === 'attached' && to.kind === 'attached' && from.objectId === to.objectId) {
    return null; // same object: no arrow (connector.no_accidental)
  }
  const { from: fp, to: tp } = resolveEndpoints({ from, to }, liveRects(doc));
  if (Math.hypot(tp.x - fp.x, tp.y - fp.y) < CONNECTOR_MIN_LENGTH_WORLD) return null;

  const id = crypto.randomUUID();
  doc.transact(() => {
    const objects = objectsOf(doc);
    const obj = new Y.Map();
    obj.set('type', 'connector');
    // x/y/width/height stored 0; the bbox is derived in allObjects from the
    // resolved endpoints (which follow object moves without writes).
    obj.set('x', 0);
    obj.set('y', 0);
    obj.set('width', 0);
    obj.set('height', 0);
    obj.set('from', { ...from });
    obj.set('to', { ...to });
    obj.set('z', maxZ(objects) + 1);
    obj.set('createdAt', Date.now());
    obj.set('createdBy', by);
    objects.set(id, obj);
  }, LOCAL_ORIGIN);
  return id;
}

/**
 * Replaces one endpoint of a connector (connector.reattach: handle released
 * over an object → attached; over empty space → free). Returns true when
 * applied; false (no transaction) for a stale id, a malformed endpoint,
 * non-finite points, or attaching to the object at the OPPOSITE end.
 */
export function setConnectorEndpoint(
  doc: Y.Doc,
  id: string,
  end: 'from' | 'to',
  e: Endpoint,
): boolean {
  if (!isValidEndpoint(e)) return false;
  const obj = connectorOf(doc, id);
  if (!obj) return false;
  const other = (end === 'from' ? 'to' : 'from') as 'from' | 'to';
  const otherEp = parseEndpoint(obj.get(other));
  if (otherEp?.kind === 'attached' && e.kind === 'attached' && e.objectId === otherEp.objectId) {
    return false; // re-attach onto the object at the other end: rejected
  }
  doc.transact(() => {
    obj.set(end, { ...e });
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Converts every attached endpoint on `deletedIds` to a `free` endpoint at
 * the object's CURRENT side anchor (connector.target_deleted). Must be
 * called inside the caller's open transaction (deleteObjects does this
 * before removing the objects, so the current rects are still available).
 */
export function detachConnectorsTo(doc: Y.Doc, deletedIds: readonly string[]): void {
  const deleted = new Set(deletedIds);
  if (deleted.size === 0) return;
  const rects = liveRects(doc); // deleted objects still present (caller removes after)
  objectsOf(doc).forEach((obj) => {
    if (!(obj instanceof Y.Map) || obj.get('type') !== 'connector') return;
    for (const end of ['from', 'to'] as const) {
      const ep = parseEndpoint(obj.get(end));
      if (!ep || ep.kind !== 'attached' || !deleted.has(ep.objectId)) continue;
      const other = parseEndpoint(obj.get(end === 'from' ? 'to' : 'from'));
      // Current anchor: this end's side nearest the other end's anchor.
      const target = rects.get(ep.objectId);
      if (target) {
        const toward: Point =
          other === null
            ? { x: target.x + target.width / 2, y: target.y + target.height / 2 }
            : other.kind === 'free'
              ? { x: other.x, y: other.y }
              : rects.get(other.objectId)
                ? {
                    x: (rects.get(other.objectId) as Rect).x + (rects.get(other.objectId) as Rect).width / 2,
                    y: (rects.get(other.objectId) as Rect).y + (rects.get(other.objectId) as Rect).height / 2,
                  }
                : other.fallback;
        obj.set(end, { kind: 'free', ...sideAnchor(target, nearestSide(target, toward)) });
      } else {
        // Target rect somehow absent: pin at the stored fallback.
        obj.set(end, { kind: 'free', x: ep.fallback.x, y: ep.fallback.y });
      }
    }
  });
}

/** The connector's endpoints as a snap, or undefined for a stale id. */
export function connectorSnapOf(doc: Y.Doc, id: string): ConnectorSnap | undefined {
  const obj = connectorOf(doc, id);
  if (!obj) return undefined;
  const from = parseEndpoint(obj.get('from'));
  const to = parseEndpoint(obj.get('to'));
  if (!from || !to) return undefined;
  const x = obj.get('x');
  const y = obj.get('y');
  return {
    id,
    type: 'connector',
    x: typeof x === 'number' ? x : 0,
    y: typeof y === 'number' ? y : 0,
    z: (obj.get('z') as number) ?? 0,
    from,
    to,
  };
}
