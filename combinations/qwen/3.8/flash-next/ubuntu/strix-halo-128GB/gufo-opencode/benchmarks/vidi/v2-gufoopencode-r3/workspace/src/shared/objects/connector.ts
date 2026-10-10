import * as Y from 'yjs';
import { LOCAL_ORIGIN, type ObjectSnapshot } from '../board-model';
import { CONNECTOR_MIN_LENGTH_WORLD, STICKY_SIZE_WORLD } from '../config';
import { connectorBBox, resolveEndpoints } from '../geometry/connector-geometry';
import type { Point, Rect } from '../geometry';

export type Endpoint =
  | { kind: 'attached'; objectId: string; fallback: Point }
  | { kind: 'free'; x: number; y: number };

export interface ConnectorSnap extends ObjectSnapshot {
  readonly type: 'connector';
  readonly from: Endpoint;
  readonly to: Endpoint;
}

// Render view of a connector: stored endpoints plus where they currently
// resolve, and which ends are orphaned (attached to a vanished object).
export interface ConnectorView extends ConnectorSnap {
  readonly resolved: { readonly from: Point; readonly to: Point };
  readonly orphaned: { readonly from: boolean; readonly to: boolean };
}

function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects');
}

function connectorMap(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  const obj = objectsMap(doc).get(id);
  if (obj === undefined || obj.get('type') !== 'connector') return undefined;
  return obj;
}

function finiteNumber(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value);
}

export function isEndpoint(value: unknown): value is Endpoint {
  if (value === null || typeof value !== 'object') return false;
  const e = value as Record<string, unknown>;
  if (e['kind'] === 'free') {
    return finiteNumber(e['x']) && finiteNumber(e['y']);
  }
  if (e['kind'] === 'attached') {
    if (typeof e['objectId'] !== 'string' || e['objectId'] === '') return false;
    const fallback = e['fallback'] as Record<string, unknown> | undefined;
    return (
      fallback !== undefined &&
      typeof fallback === 'object' &&
      finiteNumber(fallback['x']) &&
      finiteNumber(fallback['y'])
    );
  }
  return false;
}

// Reads a stored endpoint (Y.Map) back into a plain Endpoint.
export function readEndpoint(value: unknown): Endpoint | null {
  if (value instanceof Y.Map) {
    const kind = value.get('kind');
    if (kind === 'free') {
      const x = value.get('x');
      const y = value.get('y');
      if (finiteNumber(x) && finiteNumber(y)) return { kind: 'free', x, y };
      return null;
    }
    if (kind === 'attached') {
      const objectId = value.get('objectId');
      const fallback = value.get('fallback');
      if (
        typeof objectId === 'string' &&
        objectId !== '' &&
        fallback instanceof Y.Map &&
        finiteNumber(fallback.get('x')) &&
        finiteNumber(fallback.get('y'))
      ) {
        return {
          kind: 'attached',
          objectId,
          fallback: { x: fallback.get('x') as number, y: fallback.get('y') as number }
        };
      }
      return null;
    }
    return null;
  }
  return isEndpoint(value) ? (value as Endpoint) : null;
}

function endpointToY(e: Endpoint): Y.Map<unknown> {
  const m = new Y.Map<unknown>();
  m.set('kind', e.kind);
  if (e.kind === 'free') {
    m.set('x', e.x);
    m.set('y', e.y);
  } else {
    m.set('objectId', e.objectId);
    const fallback = new Y.Map<number>();
    fallback.set('x', e.fallback.x);
    fallback.set('y', e.fallback.y);
    m.set('fallback', fallback);
  }
  return m;
}

// Current rectangles of every object, read straight from the document (no
// call into snapshotAll — board-model imports this module, so going through
// snapshotAll would recurse). Connectors resolve to the bbox of their
// endpoints; two refinement passes let connector-to-connector attachments
// see each other's boxes.
function buildRects(doc: Y.Doc): { rects: Map<string, Rect>; connectors: string[] } {
  const rects = new Map<string, Rect>();
  const connectors: Array<{ id: string; snap: ConnectorSnap }> = [];
  for (const [id, obj] of objectsMap(doc)) {
    const type = obj.get('type');
    const x = obj.get('x');
    const y = obj.get('y');
    if (type === 'connector') {
      const from = readEndpoint(obj.get('from'));
      const to = readEndpoint(obj.get('to'));
      if (from === null || to === null) continue;
      connectors.push({
        id,
        snap: { id, type: 'connector', x: 0, y: 0, z: 0, from, to }
      });
      continue;
    }
    if (typeof type !== 'string' || typeof x !== 'number' || typeof y !== 'number') continue;
    const width = obj.get('width');
    const height = obj.get('height');
    rects.set(id, {
      x,
      y,
      width: typeof width === 'number' && width > 0 ? width : STICKY_SIZE_WORLD,
      height: typeof height === 'number' && height > 0 ? height : STICKY_SIZE_WORLD
    });
  }
  for (let pass = 0; pass < 2; pass++) {
    for (const { id, snap } of connectors) {
      const { from, to } = resolveEndpoints(snap, rects);
      rects.set(id, connectorBBox(from, to));
    }
  }
  return { rects, connectors: connectors.map((c) => c.id) };
}

// Derived bounding boxes for connectors, consumed by board-model's
// snapshotAll so generic bounds/selection code sees real arrow extents.
export function collectConnectorBBoxes(doc: Y.Doc): Map<string, Rect> {
  const { rects, connectors } = buildRects(doc);
  const out = new Map<string, Rect>();
  for (const id of connectors) {
    const r = rects.get(id);
    if (r !== undefined) out.set(id, r);
  }
  return out;
}

function maxZ(doc: Y.Doc): number {
  let top = 0;
  for (const obj of objectsMap(doc).values()) {
    const z = obj.get('z');
    if (typeof z === 'number' && z > top) top = z;
  }
  return top;
}

export function createConnector(
  doc: Y.Doc,
  from: Endpoint,
  to: Endpoint,
  by: string
): string | null {
  if (!isEndpoint(from) || !isEndpoint(to)) return null;
  if (from.kind === 'attached' && to.kind === 'attached' && from.objectId === to.objectId) {
    return null;
  }
  const { rects } = buildRects(doc);
  const snap: ConnectorSnap = {
    id: '',
    type: 'connector',
    x: 0,
    y: 0,
    z: 0,
    from,
    to
  };
  const resolved = resolveEndpoints(snap, rects);
  if (
    Math.hypot(resolved.to.x - resolved.from.x, resolved.to.y - resolved.from.y) <
    CONNECTOR_MIN_LENGTH_WORLD
  ) {
    return null;
  }
  // Attached ends persist their attach-time anchor as the orphan fallback.
  const storedFrom: Endpoint =
    from.kind === 'attached' ? { kind: 'attached', objectId: from.objectId, fallback: resolved.from } : from;
  const storedTo: Endpoint =
    to.kind === 'attached' ? { kind: 'attached', objectId: to.objectId, fallback: resolved.to } : to;

  const id = crypto.randomUUID();
  doc.transact(() => {
    const obj = new Y.Map<unknown>();
    obj.set('type', 'connector');
    obj.set('x', 0);
    obj.set('y', 0);
    obj.set('width', 0);
    obj.set('height', 0);
    obj.set('from', endpointToY(storedFrom));
    obj.set('to', endpointToY(storedTo));
    obj.set('z', maxZ(doc) + 1);
    obj.set('createdAt', Date.now());
    obj.set('createdBy', by);
    objectsMap(doc).set(id, obj);
  }, LOCAL_ORIGIN);
  return id;
}

function endpointsEqual(a: Endpoint, b: Endpoint): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'free' && b.kind === 'free') return a.x === b.x && a.y === b.y;
  if (a.kind === 'attached' && b.kind === 'attached') {
    return (
      a.objectId === b.objectId &&
      a.fallback.x === b.fallback.x &&
      a.fallback.y === b.fallback.y
    );
  }
  return false;
}

export function setConnectorEndpoint(
  doc: Y.Doc,
  id: string,
  end: 'from' | 'to',
  e: Endpoint
): boolean {
  if (!isEndpoint(e)) return false;
  const obj = connectorMap(doc, id);
  if (obj === undefined) return false;
  const other = readEndpoint(obj.get(end === 'from' ? 'to' : 'from'));
  if (
    e.kind === 'attached' &&
    other !== null &&
    other.kind === 'attached' &&
    other.objectId === e.objectId
  ) {
    return false; // both ends on the same object
  }
  const current = readEndpoint(obj.get(end));
  if (current !== null && endpointsEqual(current, e)) return false;
  doc.transact(() => {
    obj.set(end, endpointToY(e));
  }, LOCAL_ORIGIN);
  return true;
}

// Called by board-model's deleteObjects inside the same LOCAL_ORIGIN
// transaction: every end attached to a deleted object becomes free at the
// point it was drawn, so the arrow survives (connector.target_deleted).
export function detachConnectorsTo(doc: Y.Doc, deletedIds: readonly string[]): void {
  const deleted = new Set(deletedIds);
  const { rects } = buildRects(doc); // still includes the doomed objects
  for (const [, obj] of objectsMap(doc)) {
    if (obj.get('type') !== 'connector') continue;
    const from = readEndpoint(obj.get('from'));
    const to = readEndpoint(obj.get('to'));
    if (from === null || to === null) continue;
    const resolved = resolveEndpoints(
      { id: '', type: 'connector', x: 0, y: 0, z: 0, from, to },
      rects
    );
    let nextFrom = from;
    let nextTo = to;
    let touched = false;
    if (from.kind === 'attached' && deleted.has(from.objectId)) {
      nextFrom = { kind: 'free', x: resolved.from.x, y: resolved.from.y };
      touched = true;
    }
    if (to.kind === 'attached' && deleted.has(to.objectId)) {
      nextTo = { kind: 'free', x: resolved.to.x, y: resolved.to.y };
      touched = true;
    }
    if (!touched) continue;
    if (nextFrom !== from) obj.set('from', endpointToY(nextFrom));
    if (nextTo !== to) obj.set('to', endpointToY(nextTo));
  }
}

function isOrphaned(e: Endpoint, doc: Y.Doc): boolean {
  return e.kind === 'attached' && objectsMap(doc).get(e.objectId) === undefined;
}

// Render/test view: stored endpoints plus resolved points and orphan flags.
export function collectConnectorViews(doc: Y.Doc): readonly ConnectorView[] {
  const { rects } = buildRects(doc);
  const out: ConnectorView[] = [];
  for (const [id, obj] of objectsMap(doc)) {
    if (obj.get('type') !== 'connector') continue;
    const from = readEndpoint(obj.get('from'));
    const to = readEndpoint(obj.get('to'));
    if (from === null || to === null) continue;
    const z = obj.get('z');
    const snap: ConnectorSnap = {
      id,
      type: 'connector',
      x: 0,
      y: 0,
      z: typeof z === 'number' ? z : 0,
      from,
      to
    };
    out.push({
      ...snap,
      resolved: resolveEndpoints(snap, rects),
      orphaned: { from: isOrphaned(from, doc), to: isOrphaned(to, doc) }
    });
  }
  return out;
}
