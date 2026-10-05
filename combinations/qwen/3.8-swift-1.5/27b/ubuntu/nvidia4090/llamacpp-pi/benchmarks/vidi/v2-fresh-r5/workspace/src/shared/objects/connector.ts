/**
 * Connector object model (story 10). Schema helpers for creating and modifying
 * connector objects in the Y.Doc.
 */
import * as Y from 'yjs';
import {
  LOCAL_ORIGIN,
} from '../board-model';
import {
  CONNECTOR_MIN_LENGTH_WORLD,
} from '../config';
import type { Point } from '../geometry';
import {
  type Endpoint,
  sideAnchor,
  nearestSide,
} from '../geometry/connector-geometry';

function getObjects(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects') as Y.Map<Y.Map<unknown>>;
}

function isFinitePoint(p: Point): boolean {
  return Number.isFinite(p.x) && Number.isFinite(p.y);
}

function getRect(doc: Y.Doc, id: string): { x: number; y: number; width: number; height: number } | null {
  const objects = getObjects(doc);
  const obj = objects.get(id);
  if (!obj) return null;
  return {
    x: obj.get('x') as number,
    y: obj.get('y') as number,
    width: (obj.get('width') as number) ?? 100,
    height: (obj.get('height') as number) ?? 100,
  };
}

/**
 * Compute the resolved endpoint position for an endpoint, given the doc.
 * Used to compute fallback points and check minimum length.
 */
function resolveEndpointPosition(doc: Y.Doc, end: Endpoint, other: Endpoint): Point {
  if (end.kind === 'free') {
    return { x: end.x, y: end.y };
  }

  const rect = getRect(doc, end.objectId);
  if (!rect) {
    return { ...end.fallback };
  }

  // Determine toward point
  let toward: Point;
  if (other.kind === 'free') {
    toward = { x: other.x, y: other.y };
  } else {
    const otherRect = getRect(doc, other.objectId);
    if (otherRect) {
      toward = { x: otherRect.x + otherRect.width / 2, y: otherRect.y + otherRect.height / 2 };
    } else {
      toward = { ...other.fallback };
    }
  }

  const side = nearestSide(rect, toward);
  return sideAnchor(rect, side);
}

/**
 * Create a new connector in the document.
 *
 * Returns the new connector's id, or null if:
 * - Both ends attach to the same object
 * - The resolved length is less than CONNECTOR_MIN_LENGTH_WORLD
 * - Any point is non-finite
 */
export function createConnector(
  doc: Y.Doc,
  from: Endpoint,
  to: Endpoint,
  by: string,
): string | null {
  // Validate: no self-connection
  if (from.kind === 'attached' && to.kind === 'attached' && from.objectId === to.objectId) {
    return null;
  }

  // Validate points are finite
  if (from.kind === 'free' && !isFinitePoint(from)) return null;
  if (to.kind === 'free' && !isFinitePoint(to)) return null;

  // Compute resolved positions to check minimum length
  const fromPos = resolveEndpointPosition(doc, from, to);
  const toPos = resolveEndpointPosition(doc, to, from);
  const length = Math.hypot(toPos.x - fromPos.x, toPos.y - fromPos.y);
  if (length < CONNECTOR_MIN_LENGTH_WORLD) return null;

  // Compute fallback points
  let fromFallback: Point;
  let toFallback: Point;

  if (from.kind === 'attached') {
    fromFallback = fromPos;
  } else {
    fromFallback = { ...from };
  }
  if (to.kind === 'attached') {
    toFallback = toPos;
  } else {
    toFallback = { ...to };
  }

  const id = crypto.randomUUID();
  const objects = getObjects(doc);

  // Compute maxZ
  let maxZ = 0;
  objects.forEach((obj) => {
    const z = obj.get('z') as number;
    if (typeof z === 'number' && z > maxZ) maxZ = z;
  });

  const connMap = new Y.Map<unknown>();
  connMap.set('type', 'connector');
  connMap.set('x', 0);
  connMap.set('y', 0);
  connMap.set('width', 0);
  connMap.set('height', 0);
  connMap.set('from', { ...from, fallback: from.kind === 'attached' ? fromFallback : undefined });
  connMap.set('to', { ...to, fallback: to.kind === 'attached' ? toFallback : undefined });
  connMap.set('z', maxZ + 1);
  connMap.set('createdAt', Date.now());
  connMap.set('createdBy', by);

  doc.transact(() => {
    objects.set(id, connMap);
  }, LOCAL_ORIGIN);

  return id;
}

/**
 * Set a connector's endpoint. Returns true if applied.
 *
 * Returns false if:
 * - The connector id is stale (not found)
 * - Attaching to the object at the opposite end
 * - The point is non-finite (for free endpoints)
 */
export function setConnectorEndpoint(
  doc: Y.Doc,
  id: string,
  end: 'from' | 'to',
  e: Endpoint,
): boolean {
  const objects = getObjects(doc);
  const obj = objects.get(id);
  if (!obj) return false;

  // Validate finite points
  if (e.kind === 'free' && !isFinitePoint(e)) return false;

  // Check opposite end
  const oppositeKey = end === 'from' ? 'to' : 'from';
  const opposite = obj.get(oppositeKey) as Endpoint;
  if (e.kind === 'attached' && opposite.kind === 'attached' && e.objectId === opposite.objectId) {
    return false;
  }

  // Compute fallback
  let fallback: Point;
  if (e.kind === 'attached') {
    const rect = getRect(doc, e.objectId);
    if (rect) {
      const toward = opposite.kind === 'free'
        ? { x: opposite.x, y: opposite.y }
        : (() => {
            const r = getRect(doc, opposite.objectId);
            return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : { x: 0, y: 0 };
          })();
      const side = nearestSide(rect, toward);
      fallback = sideAnchor(rect, side);
    } else {
      fallback = { x: 0, y: 0 };
    }
  } else {
    fallback = { ...e };
  }

  const newEndpoint = e.kind === 'attached'
    ? { kind: 'attached' as const, objectId: e.objectId, fallback }
    : { kind: 'free' as const, x: e.x, y: e.y };

  doc.transact(() => {
    obj.set(end, newEndpoint);
  }, LOCAL_ORIGIN);

  return true;
}

/**
 * Detach all connector ends that are attached to any of the given deleted ids.
 * Each attached end becomes a free endpoint at its current anchor position.
 * Must be called inside an open transaction (the caller's LOCAL_ORIGIN transaction).
 */
export function detachConnectorsTo(doc: Y.Doc, deletedIds: string[]): void {
  if (deletedIds.length === 0) return;
  const deletedSet = new Set(deletedIds);
  const objects = getObjects(doc);

  objects.forEach((obj, id) => {
    if (deletedSet.has(id)) return; // skip deleted objects themselves
    const type = obj.get('type');
    if (type !== 'connector') return;

    const from = obj.get('from') as Endpoint | undefined;
    const to = obj.get('to') as Endpoint | undefined;

    if (from && from.kind === 'attached' && deletedSet.has(from.objectId)) {
      // Resolve the current anchor position
      const rect = getRect(doc, from.objectId);
      const anchor = rect
        ? (() => {
            const toPos = to?.kind === 'free' ? { x: to.x, y: to.y } : { x: 0, y: 0 };
            const toward = to?.kind === 'attached' ? (() => {
              const r = getRect(doc, to.objectId);
              return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : { x: 0, y: 0 };
            })() : toPos;
            const side = nearestSide(rect, toward);
            return sideAnchor(rect, side);
          })()
        : { x: 0, y: 0 };
      obj.set('from', { kind: 'free', x: anchor.x, y: anchor.y });
    }

    if (to && to.kind === 'attached' && deletedSet.has(to.objectId)) {
      const rect = getRect(doc, to.objectId);
      const anchor = rect
        ? (() => {
            const fromPos = from?.kind === 'free' ? { x: from.x, y: from.y } : { x: 0, y: 0 };
            const toward = from?.kind === 'attached' ? (() => {
              const r = getRect(doc, from.objectId);
              return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : { x: 0, y: 0 };
            })() : fromPos;
            const side = nearestSide(rect, toward);
            return sideAnchor(rect, side);
          })()
        : { x: 0, y: 0 };
      obj.set('to', { kind: 'free', x: anchor.x, y: anchor.y });
    }
  });
}
