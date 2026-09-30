import * as Y from 'yjs';
import { CONNECTOR_MIN_LENGTH_WORLD } from '@shared/config';
import { LOCAL_ORIGIN, _registerTypeForModel, _registerDetachConnectors } from '@shared/board-model';
import type { Rect, Point } from '@shared/geometry';
import { nearestSide, sideAnchor, resolveEndpoints, connectorBBox } from '@shared/geometry/connector-geometry';
import { distanceBetweenPoints } from '@shared/geometry/polyline';

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

// Register 'connector' type with board-model
_registerTypeForModel('connector');
_registerDetachConnectors(detachConnectorsTo);

/**
 * Create a connector. Returns null on same-object, too-short, or non-finite inputs.
 */
export function createConnector(
  doc: Y.Doc,
  from: Endpoint,
  to: Endpoint,
  by: string,
): string | null {
  // Validate same-object
  if (from.kind === 'attached' && to.kind === 'attached' && from.objectId === to.objectId) {
    return null;
  }

  // Validate finite points
  if (from.kind === 'free' && (!Number.isFinite(from.x) || !Number.isFinite(from.y))) return null;
  if (to.kind === 'free' && (!Number.isFinite(to.x) || !Number.isFinite(to.y))) return null;
  if (from.kind === 'attached' && (!Number.isFinite(from.fallback.x) || !Number.isFinite(from.fallback.y))) return null;
  if (to.kind === 'attached' && (!Number.isFinite(to.fallback.x) || !Number.isFinite(to.fallback.y))) return null;

  // Compute resolved positions for length check
  const fromPt = from.kind === 'free' ? { x: from.x, y: from.y } : from.fallback;
  const toPt = to.kind === 'free' ? { x: to.x, y: to.y } : to.fallback;

  const length = distanceBetweenPoints(fromPt, toPt);
  if (length < CONNECTOR_MIN_LENGTH_WORLD) return null;

  const objects = doc.getMap<Y.Map<unknown>>('objects');
  const id = crypto.randomUUID();

  let maxZ = 0;
  objects.forEach((obj) => {
    const z = (obj.get('z') as number) ?? 0;
    if (z > maxZ) maxZ = z;
  });

  doc.transact(() => {
    const obj = new Y.Map<unknown>();
    obj.set('type', 'connector');
    obj.set('x', 0);
    obj.set('y', 0);
    obj.set('width', 0);
    obj.set('height', 0);
    obj.set('z', maxZ + 1);
    obj.set('createdAt', Date.now());
    obj.set('createdBy', by);
    // Store endpoints
    const fromMap = new Y.Map<unknown>();
    fromMap.set('kind', from.kind);
    if (from.kind === 'attached') {
      fromMap.set('objectId', from.objectId);
      const fb = new Y.Map<number>();
      fb.set('x', from.fallback.x);
      fb.set('y', from.fallback.y);
      fromMap.set('fallback', fb);
    } else {
      fromMap.set('x', from.x);
      fromMap.set('y', from.y);
    }
    obj.set('from', fromMap);

    const toMap = new Y.Map<unknown>();
    toMap.set('kind', to.kind);
    if (to.kind === 'attached') {
      toMap.set('objectId', to.objectId);
      const fb = new Y.Map<number>();
      fb.set('x', to.fallback.x);
      fb.set('y', to.fallback.y);
      toMap.set('fallback', fb);
    } else {
      toMap.set('x', to.x);
      toMap.set('y', to.y);
    }
    obj.set('to', toMap);

    objects.set(id, obj);
  }, LOCAL_ORIGIN);

  return id;
}

/**
 * Set one endpoint of a connector. Returns false for stale id, non-finite,
 * or attaching to the object at the opposite end.
 */
export function setConnectorEndpoint(
  doc: Y.Doc,
  id: string,
  end: 'from' | 'to',
  e: Endpoint,
): boolean {
  const objects = doc.getMap<Y.Map<unknown>>('objects');
  const obj = objects.get(id);
  if (!obj || obj.get('type') !== 'connector') return false;

  // Validate finite
  if (e.kind === 'free' && (!Number.isFinite(e.x) || !Number.isFinite(e.y))) return false;
  if (e.kind === 'attached' && (!Number.isFinite(e.fallback.x) || !Number.isFinite(e.fallback.y))) return false;

  // Check we're not attaching to the object at the opposite end
  const oppositeKey = end === 'from' ? 'to' : 'from';
  const oppositeMap = obj.get(oppositeKey) as Y.Map<unknown> | undefined;
  if (oppositeMap && e.kind === 'attached') {
    const oppositeObjectId = oppositeMap.get('objectId') as string | undefined;
    if (oppositeObjectId === e.objectId) return false;
  }

  doc.transact(() => {
    const epMap = new Y.Map<unknown>();
    epMap.set('kind', e.kind);
    if (e.kind === 'attached') {
      epMap.set('objectId', e.objectId);
      const fb = new Y.Map<number>();
      fb.set('x', e.fallback.x);
      fb.set('y', e.fallback.y);
      epMap.set('fallback', fb);
    } else {
      epMap.set('x', e.x);
      epMap.set('y', e.y);
    }
    obj.set(end, epMap);
  }, LOCAL_ORIGIN);

  return true;
}

/**
 * Called inside an open transaction (from deleteObjects). Converts attached
 * endpoints on deleted ids to free at the current anchor point.
 */
export function detachConnectorsTo(doc: Y.Doc, deletedIds: string[]): void {
  if (deletedIds.length === 0) return;
  const deletedSet = new Set(deletedIds);
  const objects = doc.getMap<Y.Map<unknown>>('objects');

  // Build rects for resolveEndpoints
  const rects = new Map<string, Rect>();
  objects.forEach((obj, id) => {
    const type = obj.get('type') as string;
    if (type === 'connector') return;
    rects.set(id, {
      x: obj.get('x') as number,
      y: obj.get('y') as number,
      width: (obj.get('width') as number) ?? 200,
      height: (obj.get('height') as number) ?? 200,
    });
  });

  objects.forEach((obj, _id) => {
    if (obj.get('type') !== 'connector') return;
    let modified = false;

    for (const key of ['from', 'to'] as const) {
      const epMap = obj.get(key) as Y.Map<unknown> | undefined;
      if (!epMap) continue;
      if (epMap.get('kind') !== 'attached') continue;
      const objectId = epMap.get('objectId') as string;
      if (!deletedSet.has(objectId)) continue;

      // Compute current anchor before detaching
      const otherKey = key === 'from' ? 'to' : 'from';
      const otherMap = obj.get(otherKey) as Y.Map<unknown>;
      const otherPt = readEndpointPoint(otherMap, rects);
      const rect = rects.get(objectId);
      let anchor: Point;
      if (rect) {
        const side = nearestSide(rect, otherPt);
        anchor = sideAnchor(rect, side);
      } else {
        const fb = epMap.get('fallback') as Y.Map<number> | undefined;
        anchor = fb ? { x: fb.get('x') as number, y: fb.get('y') as number } : { x: 0, y: 0 };
      }

      // Replace with free endpoint
      epMap.set('kind', 'free');
      epMap.set('x', anchor.x);
      epMap.set('y', anchor.y);
      epMap.delete('objectId');
      epMap.delete('fallback');
      modified = true;
    }

    void modified; // The write is already done in the caller's transaction
  });
}

function readEndpointPoint(epMap: Y.Map<unknown>, rects: ReadonlyMap<string, Rect>): Point {
  if (epMap.get('kind') === 'free') {
    return { x: epMap.get('x') as number, y: epMap.get('y') as number };
  }
  const objectId = epMap.get('objectId') as string;
  const fb = epMap.get('fallback') as Y.Map<number> | undefined;
  const rect = rects.get(objectId);
  if (rect && fb) {
    // We don't have the other end's position here to compute nearestSide perfectly,
    // so use fallback as approximation
    return { x: fb.get('x') as number, y: fb.get('y') as number };
  }
  return fb ? { x: fb.get('x') as number, y: fb.get('y') as number } : { x: 0, y: 0 };
}

/**
 * Read an endpoint from a Y.Map.
 */
export function readEndpoint(epMap: Y.Map<unknown>): Endpoint {
  const kind = epMap.get('kind') as string;
  if (kind === 'free') {
    return { kind: 'free', x: epMap.get('x') as number, y: epMap.get('y') as number };
  }
  const fb = epMap.get('fallback') as Y.Map<number>;
  return {
    kind: 'attached',
    objectId: epMap.get('objectId') as string,
    fallback: { x: fb.get('x') as number, y: fb.get('y') as number },
  };
}

/**
 * Snapshot a connector object.
 */
export function snapshotConnector(id: string, obj: Y.Map<unknown>, rects: ReadonlyMap<string, Rect>): ConnectorSnap | null {
  if (obj.get('type') !== 'connector') return null;
  const fromMap = obj.get('from') as Y.Map<unknown>;
  const toMap = obj.get('to') as Y.Map<unknown>;
  const from = readEndpoint(fromMap);
  const to = readEndpoint(toMap);

  // Derive bbox from resolved endpoints
  const resolved = resolveEndpoints({ from, to } as any, rects);
  const bbox = connectorBBox(resolved.from, resolved.to);

  return {
    id,
    type: 'connector',
    x: bbox.x,
    y: bbox.y,
    width: bbox.width,
    height: bbox.height,
    z: (obj.get('z') as number) ?? 0,
    createdAt: obj.get('createdAt') as number,
    createdBy: (obj.get('createdBy') as string) ?? '',
    from,
    to,
  };
}
