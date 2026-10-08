import * as Y from 'yjs';
import { CONNECTOR_MIN_LENGTH_WORLD, MAX_OBJECT_SIZE_WORLD } from '../config';
import type { Rect, Point } from '../geometry';
import {
  sideAnchor,
  nearestSide,
  resolveEndpoints,
  connectorBBox,
} from '../geometry/connector-geometry';
import { LOCAL_ORIGIN } from '../board-model';

export type Endpoint =
  | { kind: 'attached'; objectId: string; fallback: Point }
  | { kind: 'free'; x: number; y: number };

export interface ConnectorSnap extends Record<string, any> {
  id: string;
  type: 'connector';
  x: number;
  y: number;
  width: number;
  height: number;
  z: number;
  createdBy: string;
  createdAt: number;
  from: Endpoint;
  to: Endpoint;
}

interface ObjectsMap {
  get(key: string): Y.Map<any> | undefined;
  set(key: string, value: Y.Map<any>): void;
  has(key: string): boolean;
  delete(key: string): boolean;
  forEach(callback: (value: Y.Map<any>, key: string) => void): void;
}

function getObjects(doc: Y.Doc): ObjectsMap {
  return doc.getMap('objects') as unknown as ObjectsMap;
}

function getMaxZ(doc: Y.Doc): number {
  const objects = getObjects(doc);
  let maxZ = 0;
  objects.forEach((v) => {
    const z = v.get('z');
    if (typeof z === 'number' && z > maxZ) {
      maxZ = z;
    }
  });
  return maxZ;
}

/** Check if point coordinates are finite */
function isFinitePoint(p: { x: number; y: number }): boolean {
  return Number.isFinite(p.x) && Number.isFinite(p.y);
}

/**
 * Create a new connector object.
 * @returns id or null on rejection
 */
export function createConnector(
  doc: Y.Doc,
  fromEndpoint: Endpoint,
  toEndpoint: Endpoint,
  createdBy: string,
): string | null {
  // Validate endpoints are different types or different values
  const fromId = fromEndpoint.kind === 'attached' ? fromEndpoint.objectId : undefined;
  const toId = toEndpoint.kind === 'attached' ? toEndpoint.objectId : undefined;

  // Reject same-object connections
  if (fromId && toId && fromId === toId) {
    return null;
  }

  // Compute initial anchor points for validation
  const fromPt = endpointToPoint(fromEndpoint);
  const toPt = endpointToPoint(toEndpoint);

  // Compute distance
  const dx = toPt.x - fromPt.x;
  const dy = toPt.y - fromPt.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  // Reject too-short connectors
  if (dist < CONNECTOR_MIN_LENGTH_WORLD) {
    return null;
  }

  // Validate finiteness
  if (!isFinitePoint(fromPt) || !isFinitePoint(toPt)) {
    return null;
  }

  const id = crypto.randomUUID();
  const z = getMaxZ(doc) + 1;

  doc.transact(() => {
    const objects = getObjects(doc);
    const connMap = new Y.Map();
    connMap.set('type', 'connector');
    connMap.set('from', fromEndpoint);
    connMap.set('to', toEndpoint);
    connMap.set('x', 0);
    connMap.set('y', 0);
    connMap.set('width', 0);
    connMap.set('height', 0);
    connMap.set('z', z);
    connMap.set('createdBy', createdBy);
    connMap.set('createdAt', Date.now());
    objects.set(id, connMap);
  }, LOCAL_ORIGIN);

  return id;
}

function endpointToPoint(ep: Endpoint): Point {
  if (ep.kind === 'free') {
    return { x: ep.x, y: ep.y };
  }
  if (ep.fallback) {
    return { x: ep.fallback.x, y: ep.fallback.y };
  }
  return { x: 0, y: 0 };
}

/**
 * Set one endpoint of a connector.
 * Returns true if changed.
 */
export function setConnectorEndpoint(
  doc: Y.Doc,
  id: string,
  end: 'from' | 'to',
  ep: Endpoint,
): boolean {
  const objects = getObjects(doc);
  const connMap = objects.get(id);
  if (!connMap) {
    return false;
  }

  // Validate finiteness
  if (ep.kind === 'free' && !isFinitePoint({ x: ep.x, y: ep.y })) {
    return false;
  }

  // Read the current other endpoint to check it's not the opposite object
  const otherEndName = end === 'from' ? 'to' : 'from';
  const otherEp = connMap.get(otherEndName);

  // Validate: cannot attach to the object at the opposite end
  if (ep.kind === 'attached' && otherEp && otherEp.kind === 'attached') {
    if (ep.objectId === otherEp.objectId) {
      return false;
    }
  }

  // Check if actually changing
  const currentEp = connMap.get(end);
  if (endpointsEqual(currentEp, ep)) {
    return false;
  }

  doc.transact(() => {
    connMap.set(end, ep);
  }, LOCAL_ORIGIN);

  return true;
}

function endpointsEqual(a: any, b: any): boolean {
  if (!a || !b) return a === b;
  if (a.kind !== b.kind) return false;
  if (a.kind === 'attached' && b.kind === 'attached') {
    return a.objectId === b.objectId;
  }
  if (a.kind === 'free' && b.kind === 'free') {
    return a.x === b.x && a.y === b.y;
  }
  return false;
}

/**
 * Detach all connectors attached to the given deleted object ids.
 * Call inside an already-open transaction.
 */
export function detachConnectorsTo(doc: Y.Doc, deletedIds: string[]): void {
  const objects = getObjects(doc);
  const deletedSet = new Set(deletedIds);

  objects.forEach((connMap, connId) => {
    if (connMap.get('type') !== 'connector') return;

    const fromEp = connMap.get('from');
    const toEp = connMap.get('to');

    let changed = false;

    // Check if 'from' endpoint attaches to a deleted object
    if (fromEp.kind === 'attached' && deletedSet.has(fromEp.objectId)) {
      // Get current rect to compute anchor
      const currentFromRect = getObjectRect(objects, fromEp.objectId);
      const anchor = computeCurrentAnchor(connMap, fromEp, toEp, currentFromRect, objects);
      connMap.set('from', { kind: 'free' as const, x: anchor.x, y: anchor.y });
      changed = true;
    }

    // Check if 'to' endpoint attaches to a deleted object
    if (toEp.kind === 'attached' && deletedSet.has(toEp.objectId)) {
      const currentToRect = getObjectRect(objects, toEp.objectId);
      const anchor = computeCurrentAnchor(connMap, fromEp, toEp, currentToRect, objects);
      connMap.set('to', { kind: 'free' as const, x: anchor.x, y: anchor.y });
      changed = true;
    }
  });
}

function getObjectRect(objects: ObjectsMap, objId: string): Rect | undefined {
  const obj = objects.get(objId);
  if (!obj) return undefined;
  return {
    x: obj.get('x'),
    y: obj.get('y'),
    width: obj.get('width') ?? 200,
    height: obj.get('height') ?? 200,
  };
}

function computeCurrentAnchor(
  connMap: Y.Map<any>,
  fromEp: any,
  toEp: any,
  targetRect: Rect | undefined,
  objects: ObjectsMap,
): Point {
  if (targetRect && targetRect.width > 0 && targetRect.height > 0) {
    // Determine which endpoint refers to this target and compute its side anchor
    const otherObjId = fromEp.objectId;
    const toward = {
      x: targetRect.x + targetRect.width / 2,
      y: targetRect.y + targetRect.height / 2,
    };
    if (otherObjId && objects.has(otherObjId)) {
      const otherRect = getObjectRect(objects, otherObjId);
      if (otherRect) {
        return sideAnchor(targetRect, nearestSide(targetRect, {
          x: otherRect.x + otherRect.width / 2,
          y: otherRect.y + otherRect.height / 2,
        }));
      }
    }
  }
  // Fall back to stored fallback
  return { x: 0, y: 0 };
}
