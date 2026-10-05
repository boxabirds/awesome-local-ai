import * as Y from 'yjs';
import { LOCAL_ORIGIN, type ObjectSnapshot } from '../board-model';
import { CONNECTOR_MIN_LENGTH_WORLD } from '../config';
import type { Rect, Point } from '../geometry';
import {
  type Endpoint,
  type AttachedEndpoint,
  type FreeEndpoint,
  resolveEndpoints,
  connectorBBox,
} from '../geometry/connector-geometry';

export type { Endpoint, AttachedEndpoint, FreeEndpoint };

export interface ConnectorSnap extends ObjectSnapshot {
  type: 'connector';
  from: Endpoint;
  to: Endpoint;
}

function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects');
}

function connectorMap(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  const obj = objectsMap(doc).get(id);
  if (!obj || obj.get('type') !== 'connector') return undefined;
  return obj;
}

function maxZ(doc: Y.Doc): number {
  let max = 0;
  objectsMap(doc).forEach((obj) => {
    const z = obj.get('z');
    if (typeof z === 'number' && z > max) max = z;
  });
  return max;
}

function endpointFromMap(data: unknown): Endpoint | null {
  if (data === null || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if (d.kind === 'attached' && typeof d.objectId === 'string' && d.fallback && typeof d.fallback === 'object') {
    const f = d.fallback as Record<string, unknown>;
    if (typeof f.x === 'number' && typeof f.y === 'number') {
      return { kind: 'attached', objectId: d.objectId as string, fallback: { x: f.x, y: f.y } };
    }
  }
  if (d.kind === 'free' && typeof d.x === 'number' && typeof d.y === 'number') {
    return { kind: 'free', x: d.x, y: d.y };
  }
  return null;
}

function endpointToMap(ep: Endpoint): Record<string, unknown> {
  if (ep.kind === 'attached') {
    return { kind: 'attached', objectId: ep.objectId, fallback: { x: ep.fallback.x, y: ep.fallback.y } };
  }
  return { kind: 'free', x: ep.x, y: ep.y };
}

/**
 * Creates a connector between two endpoints. Returns null (no transaction)
 * when both ends attach to the same object or the resolved length is below
 * CONNECTOR_MIN_LENGTH_WORLD. One LOCAL_ORIGIN transaction on success.
 */
export function createConnector(doc: Y.Doc, from: Endpoint, to: Endpoint, by: string): string | null {
  // Reject self-connection
  if (from.kind === 'attached' && to.kind === 'attached' && from.objectId === to.objectId) {
    return null;
  }

  // Check minimum length
  const len = endpointDistance(from, to);
  if (len < CONNECTOR_MIN_LENGTH_WORLD) return null;

  const id = crypto.randomUUID();
  const obj = new Y.Map<unknown>();
  obj.set('type', 'connector');
  obj.set('x', 0);
  obj.set('y', 0);
  obj.set('width', 0);
  obj.set('height', 0);
  obj.set('from', endpointToMap(from));
  obj.set('to', endpointToMap(to));
  obj.set('z', maxZ(doc) + 1);
  obj.set('createdAt', Date.now());
  obj.set('createdBy', by);

  doc.transact(() => {
    objectsMap(doc).set(id, obj);
  }, LOCAL_ORIGIN);
  return id;
}

function endpointDistance(a: Endpoint, b: Endpoint): number {
  const ax = a.kind === 'free' ? a.x : a.fallback.x;
  const ay = a.kind === 'free' ? a.y : a.fallback.y;
  const bx = b.kind === 'free' ? b.x : b.fallback.x;
  const by = b.kind === 'free' ? b.y : b.fallback.y;
  return Math.hypot(bx - ax, by - ay);
}

/**
 * Sets one endpoint of a connector. Returns false (no transaction) for:
 * - stale connector id
 * - non-finite points on a free endpoint
 * - attaching to the object at the opposite end
 */
export function setConnectorEndpoint(doc: Y.Doc, id: string, end: 'from' | 'to', e: Endpoint): boolean {
  const obj = connectorMap(doc, id);
  if (!obj) return false;

  // Validate free endpoints
  if (e.kind === 'free' && (!Number.isFinite(e.x) || !Number.isFinite(e.y))) return false;

  // Reject attaching to the object at the opposite end
  const otherKey = end === 'from' ? 'to' : 'from';
  const other = endpointFromMap(obj.get(otherKey));
  if (e.kind === 'attached' && other?.kind === 'attached' && e.objectId === other.objectId) {
    return false;
  }

  doc.transact(() => {
    obj.set(end, endpointToMap(e));
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Converts every attached endpoint that references one of `deletedIds` to a
 * free endpoint at the current anchor point. Must be called inside an open
 * transaction (the caller's). Used by `deleteObjects` in board-model.
 */
export function detachConnectorsTo(doc: Y.Doc, deletedIds: string[]): void {
  const deleted = new Set(deletedIds);
  const objects = objectsMap(doc);
  const toUpdate: { obj: Y.Map<unknown>; key: 'from' | 'to'; anchor: Point }[] = [];

  objects.forEach((obj) => {
    if (obj.get('type') !== 'connector') return;
    for (const key of ['from', 'to'] as const) {
      const ep = endpointFromMap(obj.get(key));
      if (ep?.kind === 'attached' && deleted.has(ep.objectId)) {
        toUpdate.push({ obj, key, anchor: { x: ep.fallback.x, y: ep.fallback.y } });
      }
    }
  });

  for (const { obj, key, anchor } of toUpdate) {
    obj.set(key, { kind: 'free', x: anchor.x, y: anchor.y });
  }
}

/**
 * Reads a connector's endpoints from the doc. Returns null for stale/unknown ids.
 */
export function getConnectorEndpoints(doc: Y.Doc, id: string): { from: Endpoint; to: Endpoint } | null {
  const obj = connectorMap(doc, id);
  if (!obj) return null;
  const from = endpointFromMap(obj.get('from'));
  const to = endpointFromMap(obj.get('to'));
  if (!from || !to) return null;
  return { from, to };
}

/**
 * Computes the bounding box of a connector by resolving its endpoints
 * against the given rects map.
 */
export function computeConnectorBBox(doc: Y.Doc, id: string, rects: ReadonlyMap<string, Rect>): Rect | null {
  const ep = getConnectorEndpoints(doc, id);
  if (!ep) return null;
  const { from, to } = resolveEndpoints(ep.from, ep.to, rects);
  return connectorBBox(from, to);
}
