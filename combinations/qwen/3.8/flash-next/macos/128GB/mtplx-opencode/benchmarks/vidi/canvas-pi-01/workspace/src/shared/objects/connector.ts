/**
 * Story 10 · task 10 — the connector (arrow) object model (design "Connector
 * model and geometry").
 *
 * An arrow stores **two endpoints and nothing else about where it points**. Each
 * endpoint is either `attached` (an object id plus the anchor point it was
 * created at, kept only for the concurrent-delete case) or `free` (a bare world
 * point). Which side of a shape it touches is recomputed from the live
 * rectangles every time the board is read or drawn — see
 * `geometry/connector-geometry.ts` — which is what makes an arrow follow a
 * object that anyone moved, with no writes of its own.
 *
 * A `connector` record therefore stores `x`, `y`, `width` and `height` as `0`:
 * its bounding box is derived in `snapshot()`. Nothing here throws; a rejected
 * gesture returns `null`/`false` and opens no transaction.
 */
import * as Y from 'yjs';
import type { ObjectSnapshot } from '../board-model';
import { CONNECTOR_MIN_LENGTH_WORLD } from '../config';
import type { Point, Rect } from '../geometry';
import {
  nearestSide,
  resolveEndpoints,
  sideAnchor,
  type ConnectorEndpoint,
} from '../geometry/connector-geometry';
import {
  LOCAL_ORIGIN,
  finite,
  newId,
  objectRects,
  objectsOf,
  recordIsType,
  topZ,
} from '../doc';

/** The registry key for a connector. */
export const CONNECTOR_TYPE = 'connector';

/** Where an arrow end sits. Same shape as the geometry module's endpoint. */
export type Endpoint = ConnectorEndpoint;

/** An immutable connector snapshot, as `snapshot()` reports it. */
export interface ConnectorSnap extends ObjectSnapshot {
  type: 'connector';
  from: Endpoint;
  to: Endpoint;
  /** The two resolved points, derived in `snapshot()` (hit-testing needs them). */
  ends: { from: Point; to: Point };
}

/** True when the record is a connector. */
export function isConnectorRecord(
  record: Y.Map<unknown> | undefined,
): record is Y.Map<unknown> {
  return recordIsType(record, CONNECTOR_TYPE);
}

/** Read a stored endpoint back into an {@link Endpoint} (null when corrupt). */
function readEndpoint(value: unknown): Endpoint | null {
  if (!(value instanceof Object)) return null;
  const raw = value as { kind?: unknown; objectId?: unknown; x?: unknown; y?: unknown };
  if (raw.kind === 'free') {
    if (typeof raw.x !== 'number' || typeof raw.y !== 'number') return null;
    return { kind: 'free', x: raw.x, y: raw.y };
  }
  if (raw.kind === 'attached') {
    if (typeof raw.objectId !== 'string') return null;
    const fallback = raw as unknown as { fallback?: { x?: unknown; y?: unknown } };
    const fx = fallback.fallback?.x;
    const fy = fallback.fallback?.y;
    if (typeof fx !== 'number' || typeof fy !== 'number') return null;
    return { kind: 'attached', objectId: raw.objectId, fallback: { x: fx, y: fy } };
  }
  return null;
}

/** The two endpoints currently stored on a connector (null when unreadable). */
export function readConnector(record: Y.Map<unknown>): { from: Endpoint; to: Endpoint } | null {
  const from = readEndpoint(record.get('from'));
  const to = readEndpoint(record.get('to'));
  if (from === null || to === null) return null;
  return { from, to };
}

/** Is this endpoint attached to `objectId`? */
function attachedTo(end: Endpoint, objectId: string): boolean {
  return end.kind === 'attached' && end.objectId === objectId;
}

/** A point is usable when both coordinates are finite. */
function usablePoint(p: Point): boolean {
  return finite(p.x, p.y);
}

/**
 * Turn a requested endpoint into the stored form: an attached end records the
 * object id plus the anchor it points at *now* (its `fallback`), a free end
 * keeps its point. Returns `null` when the request cannot be satisfied — an
 * attached end whose object is gone has nothing to point at.
 */
function normalizeEndpoint(
  end: Endpoint,
  toward: Point,
  rects: ReadonlyMap<string, Rect>,
): Endpoint | null {
  if (end.kind === 'free') {
    if (!usablePoint(end)) return null;
    return { kind: 'free', x: end.x, y: end.y };
  }
  const rect = rects.get(end.objectId);
  if (!rect) return null;
  if (!usablePoint(toward)) return null;
  const anchor = sideAnchor(rect, nearestSide(rect, toward));
  return { kind: 'attached', objectId: end.objectId, fallback: anchor };
}

/**
 * Create a connector between two endpoints.
 *
 * Rejected, with **no** transaction (PRD `conn.no_accidental`): both ends on the
 * same object, and a resolved span shorter than
 * {@link CONNECTOR_MIN_LENGTH_WORLD} — measured between the resolved anchors, so
 * a two-pixel drag inside one note is refused rather than drawing a stub. An
 * attached end whose object does not exist is refused too.
 *
 * On success: exactly one `LOCAL_ORIGIN` transaction.
 */
export function createConnector(
  doc: Y.Doc,
  from: Endpoint,
  to: Endpoint,
  by: string,
): string | null {
  if (from.kind === 'attached' && to.kind === 'attached' && from.objectId === to.objectId) {
    return null;
  }

  const rects = objectRects(doc);
  // An attached end needs a live object to point at.
  if (from.kind === 'attached' && !rects.has(from.objectId)) return null;
  if (to.kind === 'attached' && !rects.has(to.objectId)) return null;

  const probe = { from, to };
  const resolved = resolveEndpoints(probe, rects);
  if (!usablePoint(resolved.from) || !usablePoint(resolved.to)) return null;
  const length = Math.hypot(resolved.to.x - resolved.from.x, resolved.to.y - resolved.from.y);
  if (!(length >= CONNECTOR_MIN_LENGTH_WORLD)) return null;

  const storedFrom = normalizeEndpoint(from, resolved.to, rects);
  const storedTo = normalizeEndpoint(to, resolved.from, rects);
  if (storedFrom === null || storedTo === null) return null;

  const id = newId();
  const top = topZ(doc) + 1;

  doc.transact(() => {
    const record = new Y.Map<unknown>();
    record.set('type', CONNECTOR_TYPE);
    // The bounding box is derived in `snapshot()`; the stored zeros keep the
    // generic code (`objectBounds`, `rectContains`) total without special cases.
    record.set('x', 0);
    record.set('y', 0);
    record.set('width', 0);
    record.set('height', 0);
    record.set('from', storedFrom);
    record.set('to', storedTo);
    record.set('z', top);
    record.set('createdAt', Date.now());
    record.set('createdBy', by);
    objectsOf(doc).set(id, record);
  }, LOCAL_ORIGIN);
  return id;
}

/**
 * Move one end of an existing arrow (the end-handle drag of PRD
 * `connector.reattach`).
 *
 * False, with no transaction: a stale or non-connector id, a non-finite point, a
 * target object that does not exist, or re-attaching to the object the *other*
 * end already points at (which would draw a zero-length arrow inside one shape).
 * Success is one transaction, and the new attached end stores a fresh `fallback`.
 */
export function setConnectorEndpoint(
  doc: Y.Doc,
  id: string,
  end: 'from' | 'to',
  e: Endpoint,
): boolean {
  const record = objectsOf(doc).get(id);
  if (!isConnectorRecord(record)) return false;
  const current = readConnector(record);
  if (current === null) return false;

  const otherEnd = end === 'from' ? 'to' : 'from';
  const other = current[otherEnd];
  if (e.kind === 'attached') {
    if (e.objectId.length === 0) return false;
    if (attachedTo(other, e.objectId)) return false;
  } else if (!usablePoint(e)) {
    return false;
  }

  const rects = objectRects(doc);
  const before = resolveEndpoints(current, rects);
  const toward = end === 'from' ? before.to : before.from;
  const next = normalizeEndpoint(e, toward, rects);
  if (next === null) return false;

  doc.transact(() => {
    record.set(end, next);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Detach every arrow end that pointed at one of `deletedIds`, converting it to a
 * **free** end fixed at the point where it was attached (PRD
 * `connector.target_deleted`: "Deleting an object keeps its arrows").
 *
 * Call it *inside* an open transaction and *before* the objects are removed —
 * that is how `board-model`'s `deleteObjects` does it, so a delete and its
 * detachments travel as one update and undo as one step. Ends already pointing
 * at a vanished object are normalised to their stored fallback at the same time.
 */
export function detachConnectorsTo(doc: Y.Doc, deletedIds: readonly string[]): void {
  if (deletedIds.length === 0) return;
  const doomed = new Set(deletedIds);
  const map = objectsOf(doc);
  const rects = objectRects(doc); // still holds the doomed rects: called pre-delete

  // Collect first, write second: mutating the map while iterating it is not.
  const writes: Array<[Y.Map<unknown>, Array<['from' | 'to', Endpoint]>]> = [];
  map.forEach((record) => {
    if (!isConnectorRecord(record)) return;
    const current = readConnector(record);
    if (current === null) return;
    const resolved = resolveEndpoints(current, rects);
    if (!usablePoint(resolved.from) || !usablePoint(resolved.to)) return;

    // An end counts as "pointing at a deleted object" when it is attached to one
    // of them, or when its target is already gone (a concurrent delete).
    const orphaned = (end: Endpoint): boolean =>
      end.kind === 'attached' &&
      (doomed.has(end.objectId) || !rects.has(end.objectId));

    const next: Array<['from' | 'to', Endpoint]> = [];
    if (orphaned(current.from)) {
      next.push(['from', { kind: 'free', x: resolved.from.x, y: resolved.from.y }]);
    }
    if (orphaned(current.to)) {
      next.push(['to', { kind: 'free', x: resolved.to.x, y: resolved.to.y }]);
    }
    if (next.length > 0) writes.push([record, next]);
  });

  if (writes.length === 0) return;
  // No `doc.transact` here: the caller's transaction is already open, and one
  // delete must stay one update.
  for (const [record, entries] of writes) {
    for (const [key, endpoint] of entries) record.set(key, endpoint);
  }
}
