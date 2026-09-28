import * as Y from 'yjs';
import { CONNECTOR_MIN_LENGTH_WORLD } from '../config';
import type { Point, Rect } from '../geometry';
import {
  type Endpoint,
  sideAnchor,
  nearestSide,
  resolveEndpoints,
  connectorBBox,
} from '../geometry/connector-geometry';
import { LOCAL_ORIGIN } from '../board-model';

export type { Endpoint } from '../geometry/connector-geometry';

export interface ConnectorSnapshot {
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

function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;
}

function isValidFinite(n: number): boolean {
  return Number.isFinite(n);
}

function endpointToPoint(
  ep: Endpoint,
  otherEp: Endpoint,
  rects: ReadonlyMap<string, Rect>,
): Point {
  if (ep.kind === 'free') return { x: ep.x, y: ep.y };
  const rect = rects.get(ep.objectId);
  if (!rect) return { x: ep.fallback.x, y: ep.fallback.y };
  const otherPt = otherEp.kind === 'free'
    ? { x: otherEp.x, y: otherEp.y }
    : (() => {
        const or = rects.get(otherEp.objectId);
        return or ? { x: or.x + or.width / 2, y: or.y + or.height / 2 } : { x: otherEp.fallback.x, y: otherEp.fallback.y };
      })();
  return sideAnchor(rect, nearestSide(rect, otherPt));
}

function rectsFromDoc(doc: Y.Doc): ReadonlyMap<string, Rect> {
  const objects = objectsMap(doc);
  const rects = new Map<string, Rect>();
  objects.forEach((obj, id) => {
    const type = obj.get('type') as string;
    if (type === 'connector') return;
    const x = obj.get('x') as number;
    const y = obj.get('y') as number;
    let w = obj.get('width') as number | undefined;
    let h = obj.get('height') as number | undefined;
    if (w == null || h == null) {
      // sticky default
      w = 200; h = 200;
    }
    rects.set(id, { x, y, width: w, height: h });
  });
  return rects;
}

export function createConnector(
  doc: Y.Doc,
  from: Endpoint,
  to: Endpoint,
  by: string,
): string | null {
  // Validate finiteness
  if (from.kind === 'free' && (!isValidFinite(from.x) || !isValidFinite(from.y))) return null;
  if (to.kind === 'free' && (!isValidFinite(to.x) || !isValidFinite(to.y))) return null;
  if (from.kind === 'attached' && (!isValidFinite(from.fallback.x) || !isValidFinite(from.fallback.y))) return null;
  if (to.kind === 'attached' && (!isValidFinite(to.fallback.x) || !isValidFinite(to.fallback.y))) return null;

  // Self-connection check
  if (from.kind === 'attached' && to.kind === 'attached' && from.objectId === to.objectId) return null;

  // Length check
  const rects = rectsFromDoc(doc);
  const fromPt = endpointToPoint(from, to, rects);
  const toPt = endpointToPoint(to, from, rects);
  const len = Math.sqrt((toPt.x - fromPt.x) ** 2 + (toPt.y - fromPt.y) ** 2);
  if (len < CONNECTOR_MIN_LENGTH_WORLD) return null;

  const id = crypto.randomUUID();
  const objects = objectsMap(doc);

  doc.transact(() => {
    let maxZ = 0;
    objects.forEach((obj) => {
      const z = obj.get('z') as number;
      if (z > maxZ) maxZ = z;
    });
    const yMap = new Y.Map<unknown>();
    yMap.set('type', 'connector');
    yMap.set('x', 0);
    yMap.set('y', 0);
    yMap.set('width', 0);
    yMap.set('height', 0);
    yMap.set('z', maxZ + 1);
    yMap.set('createdAt', Date.now());
    yMap.set('createdBy', by);
    yMap.set('from', from);
    yMap.set('to', to);
    objects.set(id, yMap);
  }, LOCAL_ORIGIN);

  return id;
}

export function setConnectorEndpoint(
  doc: Y.Doc,
  id: string,
  end: 'from' | 'to',
  e: Endpoint,
): boolean {
  const objects = objectsMap(doc);
  const obj = objects.get(id);
  if (!obj || obj.get('type') !== 'connector') return false;

  // Validate finiteness
  if (e.kind === 'free' && (!isValidFinite(e.x) || !isValidFinite(e.y))) return false;
  if (e.kind === 'attached' && (!isValidFinite(e.fallback.x) || !isValidFinite(e.fallback.y))) return false;

  // Check: attaching to the object at the opposite end
  const otherKey = end === 'from' ? 'to' : 'from';
  const other = obj.get(otherKey) as Endpoint | undefined;
  if (other && other.kind === 'attached' && e.kind === 'attached' && other.objectId === e.objectId) return false;

  doc.transact(() => {
    obj.set(end, e);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Call inside an already-open transaction (e.g. from deleteObjects).
 * Converts attached endpoints pointing at deleted ids to free endpoints at the current anchor.
 */
export function detachConnectorsTo(
  doc: Y.Doc,
  deletedIds: string[],
): void {
  if (deletedIds.length === 0) return;
  const objects = objectsMap(doc);
  const idSet = new Set(deletedIds);
  const rects = rectsFromDoc(doc);

  objects.forEach((obj) => {
    if (obj.get('type') !== 'connector') return;
    const from = obj.get('from') as Endpoint | undefined;
    const to = obj.get('to') as Endpoint | undefined;
    if (!from || !to) return;

    if (from.kind === 'attached' && idSet.has(from.objectId)) {
      const rect = rects.get(from.objectId);
      if (rect) {
        const otherPt = to.kind === 'free'
          ? { x: to.x, y: to.y }
          : (() => {
              const or = rects.get(to.objectId);
              return or ? { x: or.x + or.width / 2, y: or.y + or.height / 2 } : { x: to.fallback.x, y: to.fallback.y };
            })();
        const anchor = sideAnchor(rect, nearestSide(rect, otherPt));
        obj.set('from', { kind: 'free', x: anchor.x, y: anchor.y } as Endpoint);
      } else {
        obj.set('from', { kind: 'free', x: from.fallback.x, y: from.fallback.y } as Endpoint);
      }
    }

    if (to.kind === 'attached' && idSet.has(to.objectId)) {
      const rect = rects.get(to.objectId);
      if (rect) {
        const otherPt = from.kind === 'free'
          ? { x: from.x, y: from.y }
          : (() => {
              const or = rects.get(from.objectId);
              return or ? { x: or.x + or.width / 2, y: or.y + or.height / 2 } : { x: from.fallback.x, y: from.fallback.y };
            })();
        const anchor = sideAnchor(rect, nearestSide(rect, otherPt));
        obj.set('to', { kind: 'free', x: anchor.x, y: anchor.y } as Endpoint);
      } else {
        obj.set('to', { kind: 'free', x: to.fallback.x, y: to.fallback.y } as Endpoint);
      }
    }
  });
}

/**
 * Get the connector snapshot from the doc, deriving x/y/width/height from resolved endpoints.
 */
export function getConnectorSnapshot(doc: Y.Doc, id: string): ConnectorSnapshot | null {
  const objects = objectsMap(doc);
  const obj = objects.get(id);
  if (!obj || obj.get('type') !== 'connector') return null;
  const from = obj.get('from') as Endpoint;
  const to = obj.get('to') as Endpoint;
  const rects = rectsFromDoc(doc);
  const resolved = resolveEndpoints(from, to, rects);
  const bbox = connectorBBox(resolved.from, resolved.to);
  return {
    id,
    type: 'connector',
    x: bbox.x,
    y: bbox.y,
    width: bbox.width,
    height: bbox.height,
    z: obj.get('z') as number,
    createdAt: obj.get('createdAt') as number,
    createdBy: (obj.get('createdBy') as string) ?? '',
    from,
    to,
  };
}
