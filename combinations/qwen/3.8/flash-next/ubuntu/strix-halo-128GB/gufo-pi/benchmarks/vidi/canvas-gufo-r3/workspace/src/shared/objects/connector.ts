import * as Y from 'yjs';
import type { Point } from '@client/canvas/camera';
import type { Rect } from '../geometry';
import { LOCAL_ORIGIN } from '../board-model';
import { STICKY_SIZE_WORLD } from '../config';
import { CONNECTOR_MIN_LENGTH_WORLD } from '../config';
import {
  connectorBBox,
  endpointAnchor,
  endpointCandidate,
  resolveEndpoints,
} from '../geometry/connector-geometry';

export type Endpoint =
  | { kind: 'attached'; objectId: string; fallback: Point }
  | { kind: 'free'; x: number; y: number };

export interface ConnectorSnap {
  id: string;
  type: 'connector';
  /** Derived bounding box of the resolved endpoints (stored as 0 in the doc). */
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
  return doc.getMap('objects');
}

export function getConnectorMap(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  const m = objectsMap(doc).get(id);
  if (!m || !(m instanceof Y.Map) || m.get('type') !== 'connector') return undefined;
  return m;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function maxZ(doc: Y.Doc): number {
  let max = 0;
  objectsMap(doc).forEach((m) => {
    if (m instanceof Y.Map) {
      const z = m.get('z');
      if (isFiniteNumber(z) && z > max) max = z;
    }
  });
  return max;
}

function readEndpoint(v: unknown): Endpoint | null {
  if (!(v instanceof Y.Map)) return null;
  const kind = v.get('kind');
  if (kind === 'free') {
    const x = v.get('x');
    const y = v.get('y');
    if (!isFiniteNumber(x) || !isFiniteNumber(y)) return null;
    return { kind: 'free', x, y };
  }
  if (kind === 'attached') {
    const objectId = v.get('objectId');
    const fx = v.get('fallbackX');
    const fy = v.get('fallbackY');
    if (typeof objectId !== 'string' || !isFiniteNumber(fx) || !isFiniteNumber(fy)) return null;
    return { kind: 'attached', objectId, fallback: { x: fx, y: fy } };
  }
  return null;
}

function endpointToYMap(e: Endpoint): Y.Map<unknown> {
  const m = new Y.Map<unknown>();
  if (e.kind === 'free') {
    m.set('kind', 'free');
    m.set('x', e.x);
    m.set('y', e.y);
  } else {
    m.set('kind', 'attached');
    m.set('objectId', e.objectId);
    m.set('fallbackX', e.fallback.x);
    m.set('fallbackY', e.fallback.y);
  }
  return m;
}

/** Rect of a single object map (any board object type), or null if it has no valid box. */
function rectOfMap(m: Y.Map<unknown>): Rect | null {
  const x = m.get('x');
  const y = m.get('y');
  if (!isFiniteNumber(x) || !isFiniteNumber(y)) return null;
  const type = m.get('type');
  let width = m.get('width');
  let height = m.get('height');
  if (type === 'sticky') {
    if (!isFiniteNumber(width)) width = STICKY_SIZE_WORLD;
    if (!isFiniteNumber(height)) height = STICKY_SIZE_WORLD;
  }
  if (!isFiniteNumber(width) || !isFiniteNumber(height)) return null;
  return { x, y, width, height };
}

/** Live map of object id -> rect for every object in the doc (including shapes and stickies). */
export function rectsFromDoc(doc: Y.Doc): Map<string, Rect> {
  const rects = new Map<string, Rect>();
  objectsMap(doc).forEach((m, id) => {
    if (!(m instanceof Y.Map) || m.get('type') === 'connector') return;
    const r = rectOfMap(m);
    if (r) rects.set(id, r);
  });
  return rects;
}

function validEndpoint(e: Endpoint): boolean {
  if (e.kind === 'free') return isFiniteNumber(e.x) && isFiniteNumber(e.y);
  return (
    typeof e.objectId === 'string' &&
    e.objectId !== '' &&
    !!e.fallback &&
    isFiniteNumber(e.fallback.x) &&
    isFiniteNumber(e.fallback.y)
  );
}

/**
 * Create an arrow between two endpoints.
 * Rejects (null, no transaction) when both ends attach to the same object or the
 * resolved length is below CONNECTOR_MIN_LENGTH_WORLD. Attached endpoints store
 * `fallback = sideAnchor(rect, nearestSide(rect, otherEnd))` at creation.
 */
export function createConnector(doc: Y.Doc, from: Endpoint, to: Endpoint, by: string): string | null {
  if (!validEndpoint(from) || !validEndpoint(to)) return null;
  if (from.kind === 'attached' && to.kind === 'attached' && from.objectId === to.objectId) return null;

  const rects = rectsFromDoc(doc);
  const resolved = resolveEndpoints({ from, to }, rects);
  const length = Math.hypot(resolved.to.x - resolved.from.x, resolved.to.y - resolved.from.y);
  if (!Number.isFinite(length) || length < CONNECTOR_MIN_LENGTH_WORLD) return null;

  // Compute fallback anchors from the current geometry for attached ends
  const fromResolved: Endpoint =
    from.kind === 'attached'
      ? { ...from, fallback: endpointAnchor(from, rects, endpointCandidate(to, rects)) }
      : from;
  const toResolved: Endpoint =
    to.kind === 'attached'
      ? { ...to, fallback: endpointAnchor(to, rects, endpointCandidate(from, rects)) }
      : to;

  const id = crypto.randomUUID();
  doc.transact(() => {
    const m = new Y.Map<unknown>();
    m.set('type', 'connector');
    m.set('x', 0);
    m.set('y', 0);
    m.set('width', 0);
    m.set('height', 0);
    m.set('from', endpointToYMap(fromResolved));
    m.set('to', endpointToYMap(toResolved));
    m.set('z', maxZ(doc) + 1);
    m.set('createdAt', Date.now());
    m.set('createdBy', by);
    objectsMap(doc).set(id, m);
  }, LOCAL_ORIGIN);
  return id;
}

/**
 * Re-attach or detach one end of an existing connector.
 * Returns false for a stale id, a non-finite point, or attaching onto the object
 * already held by the opposite end (the handle snaps back).
 */
export function setConnectorEndpoint(doc: Y.Doc, id: string, end: 'from' | 'to', e: Endpoint): boolean {
  const m = getConnectorMap(doc, id);
  if (!m) return false;
  if (!validEndpoint(e)) return false;

  const otherRaw = m.get(end === 'from' ? 'to' : 'from');
  const other = readEndpoint(otherRaw);
  if (e.kind === 'attached' && other && other.kind === 'attached' && other.objectId === e.objectId) {
    return false;
  }

  const rects = rectsFromDoc(doc);
  let stored: Endpoint = e;
  if (e.kind === 'attached') {
    // Anchor the fallback to the current geometry; a missing opposite end keeps
    // the caller-provided fallback.
    const toward = other ? endpointCandidate(other, rects) : e.fallback;
    stored = { ...e, fallback: endpointAnchor(e, rects, toward) };
  }

  doc.transact(() => {
    m.set(end, endpointToYMap(stored));
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Inside the caller's transaction: convert every connector end attached to one of
 * `deletedIds` into a free endpoint pinned at the current anchor point.
 */
export function detachConnectorsTo(doc: Y.Doc, deletedIds: string[]): void {
  if (deletedIds.length === 0) return;
  const deleted = new Set(deletedIds);
  const rects = rectsFromDoc(doc);
  const connectors: Array<{ m: Y.Map<unknown>; from: Endpoint; to: Endpoint }> = [];
  objectsMap(doc).forEach((m) => {
    if (!(m instanceof Y.Map) || m.get('type') !== 'connector') return;
    const from = readEndpoint(m.get('from'));
    const to = readEndpoint(m.get('to'));
    if (!from || !to) return;
    if (
      (from.kind === 'attached' && deleted.has(from.objectId)) ||
      (to.kind === 'attached' && deleted.has(to.objectId))
    ) {
      connectors.push({ m, from, to });
    }
  });
  if (connectors.length === 0) return;
  // Caller owns the transaction; write directly.
  for (const { m, from, to } of connectors) {
    const resolved = resolveEndpoints({ from, to }, rects);
    if (from.kind === 'attached' && deleted.has(from.objectId)) {
      m.set('from', endpointToYMap({ kind: 'free', x: resolved.from.x, y: resolved.from.y }));
    }
    if (to.kind === 'attached' && deleted.has(to.objectId)) {
      m.set('to', endpointToYMap({ kind: 'free', x: resolved.to.x, y: resolved.to.y }));
    }
  }
}

/** Snapshot all connectors; the box is derived from the resolved endpoints. */
export function snapshotConnector(doc: Y.Doc): readonly ConnectorSnap[] {
  const result: ConnectorSnap[] = [];
  const rects = rectsFromDoc(doc);
  objectsMap(doc).forEach((m, id) => {
    if (!(m instanceof Y.Map) || m.get('type') !== 'connector') return;
    const from = readEndpoint(m.get('from'));
    const to = readEndpoint(m.get('to'));
    const z = m.get('z');
    const createdAt = m.get('createdAt');
    const createdBy = m.get('createdBy');
    if (!from || !to || !isFiniteNumber(z)) return;
    const resolved = resolveEndpoints({ from, to }, rects);
    const box = connectorBBox(resolved.from, resolved.to);
    result.push({
      id,
      type: 'connector',
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      z,
      createdAt: isFiniteNumber(createdAt) ? createdAt : 0,
      createdBy: typeof createdBy === 'string' ? createdBy : '',
      from,
      to,
    });
  });
  result.sort((a, b) => (a.z - b.z) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return result;
}
