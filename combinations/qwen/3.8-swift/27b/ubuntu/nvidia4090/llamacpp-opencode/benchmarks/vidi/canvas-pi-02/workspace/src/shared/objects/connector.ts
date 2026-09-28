// The connector object model (story 10, connector.model): Yjs schema
// helpers for the arrows that attach board objects to each other.
//
// Schema (objects/<id>):
//   type: 'connector'
//   x, y, width, height: number   // always stored 0; the live bounding box
//                                 // is derived in objectsSnapshot() from the
//                                 // resolved endpoints
//   z: number                     // stacking; higher is on top
//   createdAt: number             // epoch ms
//   createdBy: string             // client identity of the creator
//   from: Y.Map   // { kind: 'attached', objectId, fx, fy } | { kind: 'free', x, y }
//   to: Y.Map     // same shape
//
// Decision (design): attached endpoints store NO side. The side is
// recomputed from the current rectangles every render (nearestSide), which
// is what makes arrows switch sides as objects move and follow remote moves
// without writes. `fallback` is the anchor point at attach time, used only
// if the target vanished concurrently (connector.target_deleted race).
//
// Every successful mutation is exactly one `doc.transact(fn, LOCAL_ORIGIN)`;
// rejections return null/false before opening a transaction.
// `detachConnectorsTo` writes inside the CALLER's open transaction.

import * as Y from 'yjs';
import { CONNECTOR_MIN_LENGTH_WORLD, STICKY_SIZE_WORLD } from '../config';
import {
  LOCAL_ORIGIN,
  maxZ,
  objectBounds,
  objectsMap,
  objectsSnapshot,
  registerBoardType,
  type ObjectSnapshot,
} from '../board-model';
import type { Point, Rect } from '../geometry';
import {
  connectorBBox,
  nearestSide,
  resolveEndpoints,
  sideAnchor,
  type Endpoint,
} from '../geometry/connector-geometry';

const CONNECTOR_TYPE = 'connector';

// Register the type with the board schema lazily: the board-model ↔
// object-module import cycle means a module-load-time registration would run
// before KNOWN_TYPES is initialised (TDZ). Every public entry point ensures
// registration first, which is equally good for snapshots/select-all.
function ensureType(): void {
  registerBoardType(CONNECTOR_TYPE);
}

/** Public registration seam: the CLIENT bundle calls this at module load
 *  (via the object registry) so every client knows the type BEFORE the
 *  first remote connector arrives — objectsSnapshot filters unknown
 *  types, and a client that never created a connector locally would
 *  otherwise render remote connectors as invisible. */
export function ensureConnectorType(): void {
  ensureType();
}

export type { Endpoint };

/** Snapshot of one connector (generic ObjectSnapshot + live endpoints;
 *  x/y/width/height are the derived bounding box of the resolved line). */
export interface ConnectorSnap extends ObjectSnapshot {
  type: 'connector';
  from: Endpoint;
  to: Endpoint;
}

function newId(): string {
  return crypto.randomUUID();
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Reads a stored endpoint Y.Map back to a plain Endpoint. Returns null for
 * a malformed/missing map (never throws on untrusted remote data).
 */
export function readStoredEndpoint(m: unknown): Endpoint | null {
  ensureType();
  if (!(m instanceof Y.Map)) return null;
  const kind = m.get('kind');
  if (kind === 'attached') {
    const objectId = m.get('objectId');
    if (typeof objectId !== 'string' || objectId.length === 0) return null;
    return {
      kind: 'attached',
      objectId,
      fallback: { x: num(m.get('fx')), y: num(m.get('fy')) },
    };
  }
  if (kind === 'free') {
    return { kind: 'free', x: num(m.get('x')), y: num(m.get('y')) };
  }
  return null;
}

function endpointToMap(e: Endpoint): Y.Map<unknown> {
  const m = new Y.Map<unknown>();
  if (e.kind === 'attached') {
    m.set('kind', 'attached');
    m.set('objectId', e.objectId);
    m.set('fx', e.fallback.x);
    m.set('fy', e.fallback.y);
  } else {
    m.set('kind', 'free');
    m.set('x', e.x);
    m.set('y', e.y);
  }
  return m;
}

function endpointEquals(a: Endpoint, b: Endpoint): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'free' && b.kind === 'free') return a.x === b.x && a.y === b.y;
  if (a.kind === 'attached' && b.kind === 'attached') {
    return a.objectId === b.objectId && a.fallback.x === b.fallback.x && a.fallback.y === b.fallback.y;
  }
  return false;
}

/** The live world rectangles of every NON-connector object in the doc. */
function liveRects(doc: Y.Doc): Map<string, Rect> {
  const rects = new Map<string, Rect>();
  for (const o of objectsSnapshot(doc)) {
    if (o.type === 'connector') continue;
    rects.set(o.id, objectBounds(o));
  }
  return rects;
}

function centerOf(e: Endpoint, rects: ReadonlyMap<string, Rect>): Point {
  if (e.kind === 'free') return { x: e.x, y: e.y };
  const r = rects.get(e.objectId);
  return r !== undefined
    ? { x: r.x + r.width / 2, y: r.y + r.height / 2 }
    : e.fallback;
}

/**
 * Re-stamps an attached endpoint's `fallback` to the current anchor (the
 * side midpoint nearest the OTHER end) so that a target deleted later leaves
 * the arrow at a sensible spot. Free endpoints pass through unchanged.
 */
function normalizeEndpoint(e: Endpoint, other: Endpoint, rects: ReadonlyMap<string, Rect>): Endpoint {
  if (e.kind !== 'attached') return e;
  const r = rects.get(e.objectId);
  if (r === undefined) return e;
  return { kind: 'attached', objectId: e.objectId, fallback: sideAnchor(r, nearestSide(r, centerOf(other, rects))) };
}

function connectorEntry(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  const entry = objectsMap(doc).get(id);
  return entry instanceof Y.Map && entry.get('type') === CONNECTOR_TYPE ? entry : undefined;
}

/**
 * Creates a connector between two endpoints and returns its new id.
 *
 * Rejected (null, no transaction) when both ends attach to the same object,
 * or the resolved length is below CONNECTOR_MIN_LENGTH_WORLD
 * (connector.no_accidental). Attached endpoints get `fallback =
 * sideAnchor(rect, nearestSide(rect, otherEnd))` at creation. Exactly one
 * LOCAL_ORIGIN transaction on success.
 */
export function createConnector(doc: Y.Doc, from: Endpoint, to: Endpoint, by: string): string | null {
  ensureType();
  // Validate shapes up front (both ends must be well-formed).
  if (!isEndpoint(from) || !isEndpoint(to)) return null;
  if (from.kind === 'attached' && to.kind === 'attached' && from.objectId === to.objectId) return null;

  const rects = liveRects(doc);
  const resolved = resolveEndpoints({ from, to }, rects);
  if (dist(resolved.from, resolved.to) < CONNECTOR_MIN_LENGTH_WORLD) return null;

  const entry = new Y.Map<unknown>();
  entry.set('type', CONNECTOR_TYPE);
  entry.set('x', 0);
  entry.set('y', 0);
  entry.set('width', 0);
  entry.set('height', 0);
  entry.set('z', maxZ(doc) + 1);
  entry.set('createdAt', Date.now());
  entry.set('createdBy', by);
  entry.set('from', endpointToMap(normalizeEndpoint(from, to, rects)));
  entry.set('to', endpointToMap(normalizeEndpoint(to, from, rects)));
  const id = newId();
  doc.transact(() => {
    objectsMap(doc).set(id, entry);
  }, LOCAL_ORIGIN);
  return id;
}

/**
 * Re-attaches or detaches one end of a connector (handle drag —
 * connector.reattach). Returns true when a change was applied; false for a
 * stale id, a non-finite point, attaching to the object at the OPPOSITE
 * end, or an exact no-op.
 */
export function setConnectorEndpoint(doc: Y.Doc, id: string, end: 'from' | 'to', e: Endpoint): boolean {
  ensureType();
  const entry = connectorEntry(doc, id);
  if (entry === undefined) return false;
  if (!isEndpoint(e)) return false;

  const other = readStoredEndpoint(entry.get(end === 'from' ? 'to' : 'from'));
  if (other === null) return false;
  if (e.kind === 'attached' && other.kind === 'attached' && e.objectId === other.objectId) return false;

  const current = readStoredEndpoint(entry.get(end));
  if (current !== null && endpointEquals(current, e)) return false;

  doc.transact(() => {
    entry.set(end, endpointToMap(normalizeEndpoint(e, other, liveRects(doc))));
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Converts every endpoint attached to a deleted object into a free end at
 * the current anchor (connector.target_deleted). Call INSIDE the caller's
 * open transaction (deleteObjects does); the objects must still be present
 * in the doc when this runs.
 */
export function detachConnectorsTo(doc: Y.Doc, deletedIds: string[]): void {
  if (deletedIds.length === 0) return;
  const deleted = new Set(deletedIds);
  const objects = objectsMap(doc);

  // Live rectangles of the (still present) non-connector objects.
  const rects = new Map<string, Rect>();
  for (const [id, entryRaw] of objects.entries()) {
    if (!(entryRaw instanceof Y.Map)) continue;
    const type = entryRaw.get('type');
    if (type === CONNECTOR_TYPE || typeof type !== 'string') continue;
    const entry = entryRaw as Y.Map<unknown>;
    const r: Rect =
      type === 'sticky'
        ? {
            x: num(entry.get('x')),
            y: num(entry.get('y')),
            width: num(entry.get('width')) || STICKY_SIZE_WORLD,
            height: num(entry.get('height')) || STICKY_SIZE_WORLD,
          }
        : { x: num(entry.get('x')), y: num(entry.get('y')), width: num(entry.get('width')), height: num(entry.get('height')) };
    rects.set(id, r);
  }

  for (const entryRaw of objects.values()) {
    if (!(entryRaw instanceof Y.Map) || entryRaw.get('type') !== CONNECTOR_TYPE) continue;
    const entry = entryRaw as Y.Map<unknown>;
    const from = readStoredEndpoint(entry.get('from'));
    const to = readStoredEndpoint(entry.get('to'));
    if (from === null || to === null) continue;

    const detach = (e: Endpoint, other: Endpoint): Endpoint | null => {
      if (e.kind !== 'attached' || !deleted.has(e.objectId)) return null;
      const r = rects.get(e.objectId);
      if (r === undefined) return { kind: 'free', x: e.fallback.x, y: e.fallback.y };
      const otherPoint = centerOf(other, rects);
      return { kind: 'free', ...sideAnchor(r, nearestSide(r, otherPoint)) };
    };

    const newFrom = detach(from, to);
    if (newFrom !== null) entry.set('from', endpointToMap(newFrom));
    const newTo = detach(to, from);
    if (newTo !== null) entry.set('to', endpointToMap(newTo));
  }
}

/** The connector's resolved line in world points (the live rectangles of
 *  its targets), or null for a stale/non-connector id. Used for rendering,
 *  hit tests and the free-end detach anchor. */
export function connectorResolved(doc: Y.Doc, id: string): { from: Point; to: Point } | null {
  const entry = connectorEntry(doc, id);
  if (entry === undefined) return null;
  const from = readStoredEndpoint(entry.get('from'));
  const to = readStoredEndpoint(entry.get('to'));
  if (from === null || to === null) return null;
  return resolveEndpoints({ from, to }, liveRects(doc));
}

/** The connector's extended snapshot (endpoints + derived bbox), or null
 *  for a stale/non-connector id. */
export function connectorSnapshot(doc: Y.Doc, id: string): ConnectorSnap | null {
  ensureType();
  const entry = connectorEntry(doc, id);
  if (entry === undefined) return null;
  const from = readStoredEndpoint(entry.get('from'));
  const to = readStoredEndpoint(entry.get('to'));
  if (from === null || to === null) return null;
  const resolved = resolveEndpoints({ from, to }, liveRects(doc));
  const bbox = connectorBBox(resolved.from, resolved.to);
  return {
    id,
    type: 'connector',
    x: bbox.x,
    y: bbox.y,
    width: bbox.width,
    height: bbox.height,
    z: num(entry.get('z')),
    createdAt: num(entry.get('createdAt')),
    color: undefined,
    text: '',
    from,
    to,
  };
}

function isEndpoint(e: Endpoint): boolean {
  if (e.kind === 'free') return Number.isFinite(e.x) && Number.isFinite(e.y);
  return (
    typeof e.objectId === 'string' &&
    e.objectId.length > 0 &&
    Number.isFinite(e.fallback.x) &&
    Number.isFinite(e.fallback.y)
  );
}
