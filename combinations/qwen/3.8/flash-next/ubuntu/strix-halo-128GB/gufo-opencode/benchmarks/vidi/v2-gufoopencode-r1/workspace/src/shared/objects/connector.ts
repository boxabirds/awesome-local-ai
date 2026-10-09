import * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../board-model';
import type { ObjectSnapshot } from '../board-model';
import type { Point, Rect } from '../geometry';
import { connectorBBox, nearestSide, resolveEndpoints, sideAnchor } from '../geometry/connector-geometry';
import { CONNECTOR_MIN_LENGTH_WORLD } from '../config';

// Story 10: connector objects (arrows) that attach to other objects and follow
// them when they move. See spec story 010 "Connector model".
// Endpoints are either attached (an object id plus a fallback anchor used when
// the target disappears) or free (a fixed world point). The stored x/y/width/
// height are 0; the real bounds are derived in the snapshot from the resolved
// endpoints, so any move or resize by anyone redraws the arrow for free.

export interface EndpointAttached {
  kind: 'attached';
  objectId: string;
  fallback: Point;
}

export interface EndpointFree {
  kind: 'free';
  x: number;
  y: number;
}

export type Endpoint = EndpointAttached | EndpointFree;

// The shape callers pass in: an attached target only names the object, the
// fallback anchor is computed by the model.
export type EndpointInput = { kind: 'attached'; objectId: string } | { kind: 'free'; x: number; y: number };

export type EndSide = 'from' | 'to';

export interface ConnectorSnapshot extends ObjectSnapshot {
  type: 'connector';
  from: Endpoint;
  to: Endpoint;
  resolved: { from: Point; to: Point };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function newId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c !== undefined && typeof c.randomUUID === 'function') return c.randomUUID();
  return 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function maxZ(doc: Y.Doc): number {
  let max = 0;
  for (const value of doc.getMap('objects').values()) {
    const z = (value as Y.Map<unknown>).get('z');
    if (typeof z === 'number' && z > max) max = z;
  }
  return max;
}

// Rects of every object an endpoint may anchor to (not connectors themselves).
function collectRects(doc: Y.Doc): Map<string, Rect> {
  const rects = new Map<string, Rect>();
  for (const [id, value] of doc.getMap('objects').entries()) {
    const entry = value as Y.Map<unknown>;
    const type = entry.get('type');
    if (type !== 'sticky' && type !== 'text' && type !== 'shape') continue;
    const x = entry.get('x');
    const y = entry.get('y');
    const width = entry.get('width');
    const height = entry.get('height');
    if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(width) || !isFiniteNumber(height)) continue;
    rects.set(id, { x, y, width, height });
  }
  return rects;
}

function validInput(ep: EndpointInput): boolean {
  if (ep.kind === 'free') return isFiniteNumber(ep.x) && isFiniteNumber(ep.y);
  return typeof ep.objectId === 'string' && ep.objectId.length > 0;
}

function readEndpoint(value: unknown): Endpoint | undefined {
  if (value === null || typeof value !== 'object') return undefined;
  const v = value as Record<string, unknown>;
  if (v.kind === 'free') {
    return isFiniteNumber(v.x) && isFiniteNumber(v.y) ? { kind: 'free', x: v.x, y: v.y } : undefined;
  }
  if (v.kind === 'attached') {
    const fallback = v.fallback as Record<string, unknown> | undefined;
    if (typeof v.objectId !== 'string' || fallback === undefined || typeof fallback !== 'object') return undefined;
    return isFiniteNumber(fallback.x) && isFiniteNumber(fallback.y)
      ? { kind: 'attached', objectId: v.objectId, fallback: { x: fallback.x, y: fallback.y } }
      : undefined;
  }
  return undefined;
}

function centreOf(ep: EndpointInput | Endpoint, rects: ReadonlyMap<string, Rect>): Point {
  if (ep.kind === 'free') return { x: ep.x, y: ep.y };
  const rect = rects.get(ep.objectId);
  if (rect !== undefined) return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  const fallback = (ep as EndpointAttached).fallback;
  return fallback ?? { x: 0, y: 0 };
}

function anchorInput(ep: EndpointInput, other: Point, rects: ReadonlyMap<string, Rect>): Point {
  if (ep.kind === 'free') return { x: ep.x, y: ep.y };
  const rect = rects.get(ep.objectId) as Rect;
  return sideAnchor(rect, nearestSide(rect, other));
}

export function createConnector(doc: Y.Doc, from: EndpointInput, to: EndpointInput, by: string): string | null {
  if (!validInput(from) || !validInput(to)) return null;
  if (from.kind === 'attached' && to.kind === 'attached' && from.objectId === to.objectId) return null;
  const rects = collectRects(doc);
  if (from.kind === 'attached' && !rects.has(from.objectId)) return null;
  if (to.kind === 'attached' && !rects.has(to.objectId)) return null;
  const aPoint = anchorInput(from, centreOf(to, rects), rects);
  const bPoint = anchorInput(to, centreOf(from, rects), rects);
  if (Math.hypot(aPoint.x - bPoint.x, aPoint.y - bPoint.y) < CONNECTOR_MIN_LENGTH_WORLD) return null;
  const storedFrom: Endpoint =
    from.kind === 'attached' ? { kind: 'attached', objectId: from.objectId, fallback: aPoint } : { kind: 'free', x: from.x, y: from.y };
  const storedTo: Endpoint =
    to.kind === 'attached' ? { kind: 'attached', objectId: to.objectId, fallback: bPoint } : { kind: 'free', x: to.x, y: to.y };
  const id = newId();
  const objects = doc.getMap('objects');
  doc.transact(() => {
    const entry = new Y.Map<unknown>();
    entry.set('type', 'connector');
    entry.set('x', 0);
    entry.set('y', 0);
    entry.set('width', 0);
    entry.set('height', 0);
    entry.set('from', storedFrom);
    entry.set('to', storedTo);
    entry.set('z', maxZ(doc) + 1);
    entry.set('createdAt', Date.now());
    entry.set('createdBy', by);
    objects.set(id, entry);
  }, LOCAL_ORIGIN);
  return id;
}

export function setConnectorEndpoint(doc: Y.Doc, id: string, end: EndSide, endpoint: EndpointInput): boolean {
  const objects = doc.getMap('objects');
  const entry = objects.get(id) as Y.Map<unknown> | undefined;
  if (entry === undefined || entry.get('type') !== 'connector') return false;
  if (!validInput(endpoint)) return false;
  const curFrom = readEndpoint(entry.get('from'));
  const curTo = readEndpoint(entry.get('to'));
  if (curFrom === undefined || curTo === undefined) return false;
  const rects = collectRects(doc);
  const opposite = end === 'from' ? curTo : curFrom;
  if (endpoint.kind === 'attached') {
    if (!rects.has(endpoint.objectId)) return false;
    if (opposite.kind === 'attached' && opposite.objectId === endpoint.objectId) return false;
  }
  const anchor = anchorInput(endpoint, centreOf(opposite, rects), rects);
  const stored: Endpoint =
    endpoint.kind === 'attached'
      ? { kind: 'attached', objectId: endpoint.objectId, fallback: anchor }
      : { kind: 'free', x: endpoint.x, y: endpoint.y };
  doc.transact(() => {
    entry.set(end, stored);
  }, LOCAL_ORIGIN);
  return true;
}

// Convert every attached endpoint pointing at a deleted object into a free
// endpoint pinned at its current anchor. Runs inside the caller's transaction;
// call it before the objects are actually removed so their rects are still
// available. Not wrapped in its own transaction, so it adds no extra update.
export function detachConnectorsTo(doc: Y.Doc, deletedIds: readonly string[]): void {
  const deleted = new Set(deletedIds);
  if (deleted.size === 0) return;
  const objects = doc.getMap('objects');
  const rects = collectRects(doc);
  for (const value of objects.values()) {
    const entry = value as Y.Map<unknown>;
    if (entry.get('type') !== 'connector') continue;
    const from = readEndpoint(entry.get('from'));
    const to = readEndpoint(entry.get('to'));
    if (from === undefined || to === undefined) continue;
    const anchors = resolveEndpoints({ from, to }, rects);
    if (from.kind === 'attached' && deleted.has(from.objectId)) {
      entry.set('from', { kind: 'free', x: anchors.from.x, y: anchors.from.y });
    }
    if (to.kind === 'attached' && deleted.has(to.objectId)) {
      entry.set('to', { kind: 'free', x: anchors.to.x, y: anchors.to.y });
    }
  }
}

export function readConnector(id: string, entry: Y.Map<unknown>, rects: ReadonlyMap<string, Rect>): ConnectorSnapshot | null {
  const from = readEndpoint(entry.get('from'));
  const to = readEndpoint(entry.get('to'));
  const z = entry.get('z');
  const createdAt = entry.get('createdAt');
  if (from === undefined || to === undefined || !isFiniteNumber(z)) return null;
  const resolved = resolveEndpoints({ from, to }, rects);
  const box = connectorBBox(resolved.from, resolved.to);
  return {
    id,
    type: 'connector',
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    from,
    to,
    resolved,
    z,
    createdAt: typeof createdAt === 'number' ? createdAt : 0
  };
}
