// Connectors (story 10, contract `connector.model`).
//
// The schema and every mutation a client can make to an arrow live here:
//
//   objects/<id>: Y.Map {
//     type: 'connector', z, createdAt, createdBy,
//     from: Endpoint, to: Endpoint        // see geometry/connector-geometry.ts
//   }
//
// An arrow stores NO geometry. Its line, its bounding box and which side of
// each object it leaves through are all derived from the live rectangles at
// render time, which is what lets an arrow follow a box that anyone moves —
// there is no write, so there is nothing to sync and nothing to fall out of
// date. Deleting the object at an end converts that end to `free` inside the
// SAME transaction as the delete, so an arrow never points at nothing.

import * as Y from 'yjs';
import { CONNECTOR_MIN_LENGTH_WORLD, STICKY_SIZE_WORLD } from '../config';
import type { Point, Rect } from '../geometry';
import { LOCAL_ORIGIN } from '../board-model';
import {
  type Endpoint,
  type ConnectorEnds,
  nearestSide,
  rectCenter,
  resolveEndpoints,
  sideAnchor,
} from '../geometry/connector-geometry';

export type { Endpoint, ConnectorEnds };

/** The object-map key holding the board's objects. */
const OBJECTS_KEY = 'objects';

function objects(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>(OBJECTS_KEY);
}

function connectorOf(doc: Y.Doc, id: string): Y.Map<unknown> | null {
  const obj = objects(doc).get(id);
  if (obj === undefined || obj.get('type') !== 'connector') return null;
  return obj;
}

function topZ(doc: Y.Doc): number {
  let z = 0;
  objects(doc).forEach((obj) => {
    const value = obj.get('z');
    if (typeof value === 'number' && value > z) z = value;
  });
  return z;
}

/**
 * The footprint of one object, read straight from the document.
 *
 * Arrows are deliberately excluded: an arrow attaches to a box, not to another
 * arrow, so it has no footprint to attach to.
 */
function rectOf(doc: Y.Doc, id: string): Rect | undefined {
  const obj = objects(doc).get(id);
  if (obj === undefined) return undefined;
  const type = obj.get('type');
  if (type === 'connector') return undefined;
  const x = obj.get('x');
  const y = obj.get('y');
  if (typeof x !== 'number' || typeof y !== 'number') return undefined;
  // A note created before story 7 stores no size; its footprint is the default
  // note size (the same compatibility rule `board-model.objectBounds` uses).
  const fallback = type === 'sticky' ? STICKY_SIZE_WORLD : 0;
  const width = typeof obj.get('width') === 'number' ? (obj.get('width') as number) : fallback;
  const height = typeof obj.get('height') === 'number' ? (obj.get('height') as number) : fallback;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return undefined;
  }
  return { x, y, width, height };
}

/** Every box on the board, keyed by id — the map `resolveEndpoints` wants.
 * Sticky notes created before story 7 carry no explicit size, so the caller
 * that needs those (the renderer) passes its own map; this one derives the
 * footprint from what the document stores. */
export function rectsFor(doc: Y.Doc): Map<string, Rect> {
  const rects = new Map<string, Rect>();
  objects(doc).forEach((_obj, id) => {
    const rect = rectOf(doc, id);
    if (rect) rects.set(id, rect);
  });
  return rects;
}

/** The point an end points at: a free end's own point, an attached end's
 * target centre, or the stored fallback when the target is gone. */
function towardOf(doc: Y.Doc, e: Endpoint): Point {
  if (e.kind === 'free') return { x: e.x, y: e.y };
  const rect = rectOf(doc, e.objectId);
  if (rect) return rectCenter(rect);
  return { x: e.fallback.x, y: e.fallback.y };
}

/** True when a point is finite on both axes (and so storable). */
function isPoint(p: { x: number; y: number } | undefined | null): p is { x: number; y: number } {
  return !!p && Number.isFinite(p.x) && Number.isFinite(p.y);
}

/** True when an end cannot be drawn at all.
 *
 * An end may name an object that vanished a moment ago (the delete race in
 * `connector.target_deleted`): that still makes an arrow, drawn at the anchor it
 * was aimed at. An end with no anchor, or one naming another arrow, is not a
 * drawing instruction at all — an arrow attaches to a box, never to a line. */
function unusable(doc: Y.Doc, e: Endpoint): boolean {
  if (e.kind !== 'attached') return false;
  const obj = objects(doc).get(e.objectId);
  if (obj === undefined) return !isPoint(e.fallback);
  return obj.get('type') === 'connector';
}

function sameTarget(a: Endpoint, b: Endpoint): boolean {
  return a.kind === 'attached' && b.kind === 'attached' && a.objectId === b.objectId;
}

/**
 * The endpoint to store. An attached end keeps the side anchor it leaves
 * through as `fallback`, so the arrow still draws at that point if the object
 * is deleted; a missing target keeps the caller's fallback unchanged.
 */
function withFallback(doc: Y.Doc, e: Endpoint, other: Endpoint): Endpoint {
  if (e.kind !== 'attached') return e;
  const rect = rectOf(doc, e.objectId);
  if (!rect) return e;
  return {
    kind: 'attached',
    objectId: e.objectId,
    fallback: sideAnchor(rect, nearestSide(rect, towardOf(doc, other))),
  };
}

/**
 * Draw an arrow between two ends.
 *
 * Every rejection happens BEFORE any write, so a self-connection, a too-short
 * arrow or a malformed point produces no document change at all:
 *  - both ends name the SAME object,
 *  - an end names another arrow, or names nothing and carries no anchor,
 *  - the resolved line is shorter than CONNECTOR_MIN_LENGTH_WORLD.
 */
export function createConnector(doc: Y.Doc, from: Endpoint, to: Endpoint, by: string): string | null {
  if (!from || !to) return null;
  if (from.kind === 'free' && !isPoint(from)) return null;
  if (to.kind === 'free' && !isPoint(to)) return null;
  if (sameTarget(from, to)) return null;
  if (unusable(doc, from) || unusable(doc, to)) return null;

  const rects = rectsFor(doc);
  const resolved = resolveEndpoints({ from, to }, rects);
  const length = Math.hypot(resolved.to.x - resolved.from.x, resolved.to.y - resolved.from.y);
  if (!Number.isFinite(length) || length < CONNECTOR_MIN_LENGTH_WORLD) return null;

  const id = crypto.randomUUID();
  const record = new Y.Map<unknown>();
  const map = objects(doc);
  const z = topZ(doc) + 1;
  const storedFrom = withFallback(doc, from, to);
  const storedTo = withFallback(doc, to, from);
  doc.transact(() => {
    record.set('type', 'connector');
    record.set('from', storedFrom);
    record.set('to', storedTo);
    record.set('z', z);
    record.set('createdAt', Date.now());
    record.set('createdBy', by);
    map.set(id, record);
  }, LOCAL_ORIGIN);
  return id;
}

/** Read an arrow's stored ends, or null when `id` is not an arrow. */
export function getConnectorEnds(doc: Y.Doc, id: string): ConnectorEnds | null {
  const record = connectorOf(doc, id);
  if (record === null) return null;
  const from = record.get('from') as Endpoint | undefined;
  const to = record.get('to') as Endpoint | undefined;
  if (!from || !to) return null;
  return { from, to };
}

/** Read an arrow's DRAWN ends (its two points, resolved against live boxes). */
export function resolveConnector(doc: Y.Doc, id: string): { from: Point; to: Point } | null {
  const ends = getConnectorEnds(doc, id);
  if (ends === null) return null;
  return resolveEndpoints(ends, rectsFor(doc));
}

/**
 * Move one end of an arrow (contract `connector.reattach`).
 *
 * False — and NO transaction — for a stale id, a non-finite point, an end that
 * names another arrow, or an end that would attach to the object already at the
 * other end (an arrow to itself is not an arrow). Everything else is one
 * update.
 */
export function setConnectorEndpoint(
  doc: Y.Doc,
  id: string,
  end: 'from' | 'to',
  e: Endpoint,
): boolean {
  const record = connectorOf(doc, id);
  if (record === null) return false;
  if (end !== 'from' && end !== 'to') return false;
  if (!e) return false;
  if (e.kind === 'free' && !isPoint(e)) return false;
  const otherKey: 'from' | 'to' = end === 'from' ? 'to' : 'from';
  const other = record.get(otherKey) as Endpoint | undefined;
  if (!other) return false;
  if (e.kind === 'attached') {
    if (sameTarget(e, other)) return false;
    if (unusable(doc, e)) return false;
  }
  const next = withFallback(doc, e, other);
  if (JSON.stringify(record.get(end)) === JSON.stringify(next)) return false;
  doc.transact(() => {
    record.set(end, next);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Detach every arrow end that points at something being deleted
 * (contract `connector.target_deleted`).
 *
 * Called INSIDE the delete's transaction — it opens none of its own — so the
 * arrows and the objects go in one update and one undo step. Each detached end
 * becomes `free` at the anchor it was using, so every arrow keeps exactly the
 * line it had before the delete.
 */
export function detachConnectorsTo(doc: Y.Doc, deletedIds: readonly string[]): void {
  if (deletedIds.length === 0) return;
  const doomed = new Set(deletedIds);
  const rects = rectsFor(doc);
  const updates: [Y.Map<unknown>, 'from' | 'to', Endpoint][] = [];
  objects(doc).forEach((record) => {
    if (record.get('type') !== 'connector') return;
    const from = record.get('from') as Endpoint | undefined;
    const to = record.get('to') as Endpoint | undefined;
    if (!from || !to) return;
    if (from.kind === 'attached' && doomed.has(from.objectId)) {
      const drawn = resolveEndpoints({ from, to }, rects);
      updates.push([record, 'from', { kind: 'free', x: drawn.from.x, y: drawn.from.y }]);
    }
    if (to.kind === 'attached' && doomed.has(to.objectId)) {
      const drawn = resolveEndpoints({ from, to }, rects);
      updates.push([record, 'to', { kind: 'free', x: drawn.to.x, y: drawn.to.y }]);
    }
  });
  for (const [record, key, next] of updates) record.set(key, next);
}
