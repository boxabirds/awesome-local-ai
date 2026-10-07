import * as Y from 'yjs';
import { CONNECTOR_MIN_LENGTH_WORLD } from '@/shared/config';
const LOCAL_ORIGIN = 'local-origin';
import type { ObjectSnapshot } from '@/shared/board-model';
import { sideAnchor, nearestSide, resolveEndpoints, connectorBBox, AttachedEndpoint, FreeEndpoint, Endpoint, Rect, Point } from '../geometry/connector-geometry';
import { objectBounds } from '@/shared/board-model';

export type { AttachedEndpoint, FreeEndpoint, Endpoint };

/** Connector snap for rendering — endpoints resolved by snapshot. */
export interface ConnectorSnap extends ObjectSnapshot {
  type: 'connector';
  from: Endpoint;
  to: Endpoint;
}

// ---- Helpers ----

function getField(inner: any, key: string): any {
  try {
    return inner.get(key);
  } catch {
    return undefined;
  }
}

function setField(inner: any, key: string, val: any): void {
  inner.set(key, val);
}

function getMaxZ(objects: Y.Map<any>): number {
  let max = 0;
  objects.forEach((inner: any) => {
    if (typeof inner?.get === 'function') {
      const z = Number(getField(inner, 'z'));
      if (z > max) max = z;
    }
  });
  return max;
}

/**
 * Create a connector between two endpoints. Returns the new id or null on error.
 * Rejects same-object connections and lengths below CONNECTOR_MIN_LENGTH_WORLD.
 */
export function createConnector(
  doc: Y.Doc,
  fromEp: Endpoint,
  toEp: Endpoint,
  by: string,
): string | null {
  const objectsMap = doc.getMap('objects');

  // If both attached, check they're not the same object
  if (fromEp.kind === 'attached' && toEp.kind === 'attached') {
    if (fromEp.objectId === toEp.objectId) return null;
  }

  // Collect all rects for resolution
  const rects = new Map<string, Rect>();
  objectsMap.forEach((inner: any, _key: string) => {
    if (!inner || typeof inner.get !== 'function') return;
    const r = objectBounds(inner as unknown as Record<string, unknown>);
    rects.set(_key.toString(), r);
  });

  // For computing initial distance, we need resolved points
  function dummyResolve(ep: Endpoint): Point {
    if (ep.kind === 'free') return { x: ep.x, y: ep.y };
    const rect = rects.get(ep.objectId);
    if (rect) return sideAnchor(rect, nearestSide(rect, ep.fallback));
    return { ...ep.fallback };
  }
  const fromPt = dummyResolve(fromEp);
  const toPt = dummyResolve(toEp);
  const dist = Math.sqrt((toPt.x - fromPt.x) ** 2 + (toPt.y - fromPt.y) ** 2);
  if (dist < CONNECTOR_MIN_LENGTH_WORLD) return null;

  const maxZ = getMaxZ(objectsMap);
  const id = crypto.randomUUID();
  const inner = new Y.Map() as Y.Map<unknown>;

  doc.transact(() => {
    setField(inner, 'type', 'connector');
    setField(inner, 'x', 0);
    setField(inner, 'y', 0);
    setField(inner, 'width', 0);
    setField(inner, 'height', 0);
    setField(inner, 'from', fromEp);
    setField(inner, 'to', toEp);
    setField(inner, 'z', maxZ + 1);
    setField(inner, 'createdBy', by);
    setField(inner, 'createdAt', Date.now());
    (objectsMap as any).set(id, inner);
  }, LOCAL_ORIGIN);

  return id;
}

/**
 * Set one endpoint of a connector. Returns false for stale id, non-finite point,
 * or attaching to the object at the opposite end.
 */
export function setConnectorEndpoint(
  doc: Y.Doc,
  id: string,
  end: 'from' | 'to',
  ep: Endpoint,
): boolean {
  // Validate finiteness
  if (ep.kind === 'free' && (!isFinite(ep.x) || !isFinite(ep.y))) return false;
  if (ep.kind === 'attached' && (!isFinite(ep.fallback.x) || !isFinite(ep.fallback.y))) return false;

  const objectsMap = doc.getMap('objects') as Y.Map<any>;
  const inner = objectsMap.get(id);
  if (!inner || typeof inner.get !== 'function') return false;

  // Check not attaching to the opposite end's object
  const curFrom = getField(inner, 'from') as Endpoint | undefined;
  const curTo = getField(inner, 'to') as Endpoint | undefined;

  if (end === 'from' && curTo?.kind === 'attached' && ep.kind === 'attached' && ep.objectId === curTo.objectId) {
    return false;
  }
  if (end === 'to' && curFrom?.kind === 'attached' && ep.kind === 'attached' && ep.objectId === curFrom.objectId) {
    return false;
  }

  doc.transact(() => {
    if (end === 'from') {
      setField(inner, 'from', ep);
    } else {
      setField(inner, 'to', ep);
    }
  }, LOCAL_ORIGIN);

  return true;
}

/**
 * Detach connectors that were attached to deleted objects.
 * Must be called inside an open LOCAL_ORIGIN transaction.
 * Converts each affected attached end to free at the current anchor point.
 */
export function detachConnectorsTo(doc: Y.Doc, deletedIds: readonly string[]): void {
  const objectsMap = doc.getMap('objects') as Y.Map<any>;
  const deletedSet = new Set(deletedIds);

  const rects = new Map<string, Rect>();
  objectsMap.forEach((inner: any, key: string) => {
    if (!inner || typeof inner.get !== 'function') return;
    rects.set(key, objectBounds(inner as unknown as Record<string, unknown>));
  });

  const idsToDelete: string[] = [];

  objectsMap.forEach((inner: any, key: string) => {
    if (!inner || typeof inner.get !== 'function') return;
    const type = getField(inner, 'type');
    if (type !== 'connector') return;

    const from = getField(inner, 'from') as Endpoint | undefined;
    const to = getField(inner, 'to') as Endpoint | undefined;

    let changed = false;

    if (from?.kind === 'attached' && deletedSet.has(from.objectId)) {
      // Convert to free at current anchor
      const rect = rects.get(from.objectId);
      if (rect) {
        const anchor = sideAnchor(rect, nearestSide(rect, from.fallback));
        setField(inner, 'from', { kind: 'free' as const, x: anchor.x, y: anchor.y });
      } else {
        setField(inner, 'from', { kind: 'free' as const, x: from.fallback.x, y: from.fallback.y });
      }
      changed = true;
    }

    if (to?.kind === 'attached' && deletedSet.has(to.objectId)) {
      const rect = rects.get(to.objectId);
      if (rect) {
        const anchor = sideAnchor(rect, nearestSide(rect, to.fallback));
        setField(inner, 'to', { kind: 'free' as const, x: anchor.x, y: anchor.y });
      } else {
        setField(inner, 'to', { kind: 'free' as const, x: to.fallback.x, y: to.fallback.y });
      }
      changed = true;
    }

    if (changed) {
      idsToDelete.push(key as string);
    }
  });
}
