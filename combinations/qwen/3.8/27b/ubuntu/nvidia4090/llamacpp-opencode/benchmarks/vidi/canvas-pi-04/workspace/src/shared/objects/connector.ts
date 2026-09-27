// Story 10: the connector (arrow) model (anchor: connector.model).
//
// A connector stores two endpoints. Each endpoint is either attached to a
// board object (by id) or a free world point. Attached endpoints also store a
// `fallback`: the side anchor at attach time, used when the target object is
// gone (another user deleted it in the same moment) so the arrow still
// renders (connector.fallback).
//
// Endpoints NEVER store concrete points for live objects: the rendered
// points are derived from the objects' current geometry on every snapshot
// (connector.endpoints), which is what makes arrows follow their objects when
// they are moved, resized or re-stacked — on this client and on every other
// client, because the derivation happens in the shared snapshot.
//
// Mutation conventions are the story 7/9 ones: invalid input is rejected with
// null/false and NO transaction; a success is exactly one LOCAL_ORIGIN
// transaction.

import * as Y from 'yjs';
import { CONNECTOR_MIN_LENGTH_WORLD, STICKY_SIZE_WORLD } from '../config';
import type { Point, Rect } from '../geometry';
import { resolveEndpoints } from '../geometry/connector-geometry';
import { LOCAL_ORIGIN, objectMap, type ObjectSnapshot } from '../board-model';

/**
 * One arrow endpoint. An attached endpoint keeps the target id plus a
 * fallback point (the anchor at attach time); a free endpoint is a plain
 * world point.
 */
export type Endpoint =
  | { kind: 'attached'; objectId: string; fallback: Point }
  | { kind: 'free'; x: number; y: number };

/** Immutable view of one connector, as rendered by React. */
export interface ConnectorSnap extends ObjectSnapshot {
  type: 'connector';
  from: Endpoint;
  to: Endpoint;
  /** `from` resolved against the current board (connector.endpoints). */
  fromPoint: Point;
  /** `to` resolved against the current board (connector.endpoints). */
  toPoint: Point;
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function asPoint(x: unknown, y: unknown): Point | null {
  if (typeof x !== 'number' || !Number.isFinite(x)) return null;
  if (typeof y !== 'number' || !Number.isFinite(y)) return null;
  return { x, y };
}

/** A stored endpoint value: a Y.Map (Yjs wraps plain objects) or a plain record. */
function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object') return null;
  if (value instanceof Y.Map) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of value.entries()) out[k] = v;
    return out;
  }
  return value as Record<string, unknown>;
}

/**
 * Read a stored endpoint (Y.Map or plain record) back into the Endpoint type,
 * degrading corrupt/missing values to a free origin point so rendering never
 * breaks (connector.fallback).
 */
export function readEndpoint(value: unknown): Endpoint {
  const rec = asRecord(value);
  if (rec === null) return { kind: 'free', x: 0, y: 0 };
  if (rec.kind === 'free') {
    const p = asPoint(rec.x, rec.y);
    if (p !== null) return { kind: 'free', x: p.x, y: p.y };
  } else if (rec.kind === 'attached') {
    if (typeof rec.objectId === 'string' && rec.objectId !== '') {
      const fRec = asRecord(rec.fallback);
      const p = fRec !== null ? asPoint(fRec.x, fRec.y) : null;
      if (p !== null) return { kind: 'attached', objectId: rec.objectId, fallback: p };
    }
  }
  return { kind: 'free', x: 0, y: 0 };
}

/** Runtime validation of an endpoint about to be written. */
export function isValidEndpoint(value: unknown): value is Endpoint {
  if (value === null || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (v.kind === 'free') return asPoint(v.x, v.y) !== null;
  if (v.kind === 'attached') {
    return (
      typeof v.objectId === 'string' &&
      v.objectId !== '' &&
      asPoint(
        v.fallback !== null && typeof v.fallback === 'object' ? (v.fallback as Point).x : NaN,
        v.fallback !== null && typeof v.fallback === 'object' ? (v.fallback as Point).y : NaN,
      ) !== null
    );
  }
  return false;
}

function rectOf(id: string, obj: Y.Map<unknown>): Rect {
  return {
    x: asNumber(obj.get('x'), 0),
    y: asNumber(obj.get('y'), 0),
    width: asNumber(obj.get('width'), STICKY_SIZE_WORLD),
    height: asNumber(obj.get('height'), STICKY_SIZE_WORLD),
  };
}

function rectsOfMap(map: Y.Map<Y.Map<unknown>>): Map<string, Rect> {
  const out = new Map<string, Rect>();
  for (const [id, obj] of map.entries()) {
    out.set(id, rectOf(id, obj));
  }
  return out;
}

function nextZ(map: Y.Map<Y.Map<unknown>>): number {
  let z = 1;
  for (const obj of map.values()) {
    const existing = asNumber(obj.get('z'), 0);
    if (existing >= z) z = existing + 1;
  }
  return z;
}

/**
 * Create a connector between two endpoints (connector.create_attached,
 * connector.create_free) and return its new id.
 *
 * - either endpoint may be attached or free;
 * - attached endpoints store `fallback = the side anchor at attach time`
 *   (the point the arrow actually starts/ends at now); when the target does
 *   not exist in the doc, the caller's fallback (the pointer position at
 *   release) is kept;
 * - rejected (null, no transaction): invalid endpoints, an arrow from an
 *   object to itself, or a resolved length below
 *   {@link CONNECTOR_MIN_LENGTH_WORLD}.
 */
export function createConnector(
  doc: Y.Doc,
  from: Endpoint,
  to: Endpoint,
  by: string,
): string | null {
  if (!isValidEndpoint(from) || !isValidEndpoint(to)) return null;
  if (from.kind === 'attached' && to.kind === 'attached' && from.objectId === to.objectId) {
    return null; // an arrow from an object to itself
  }

  const rects = rectsOfMap(objectMap(doc));
  const resolved = resolveEndpoints({ from, to }, rects);
  if (
    Math.hypot(resolved.to.x - resolved.from.x, resolved.to.y - resolved.from.y) <
    CONNECTOR_MIN_LENGTH_WORLD
  ) {
    return null;
  }

  const storedFrom =
    from.kind === 'free'
      ? { kind: 'free' as const, x: from.x, y: from.y }
      : { kind: 'attached' as const, objectId: from.objectId, fallback: { x: resolved.from.x, y: resolved.from.y } };
  const storedTo =
    to.kind === 'free'
      ? { kind: 'free' as const, x: to.x, y: to.y }
      : { kind: 'attached' as const, objectId: to.objectId, fallback: { x: resolved.to.x, y: resolved.to.y } };

  const id = crypto.randomUUID();
  const obj = new Y.Map<unknown>();
  obj.set('type', 'connector');
  // Common base fields are present but the geometry is DERIVED (see the
  // snapshot), so the stored values stay 0.
  obj.set('x', 0);
  obj.set('y', 0);
  obj.set('width', 0);
  obj.set('height', 0);
  obj.set('from', storedFrom);
  obj.set('to', storedTo);
  obj.set('z', nextZ(objectMap(doc)));
  obj.set('createdAt', Date.now());
  obj.set('createdBy', by);
  doc.transact(
    () => {
      objectMap(doc).set(id, obj);
    },
    LOCAL_ORIGIN,
  );
  return id;
}

/**
 * Re-point one end of a connector (connector.re_attach): drag the end handle
 * onto another object (attached) or onto empty space (free). Returns false
 * (no update) for unknown ids, non-connectors, invalid endpoints, or
 * attaching to the object the other end is already on.
 */
export function setConnectorEndpoint(
  doc: Y.Doc,
  id: string,
  which: 'from' | 'to',
  endpoint: Endpoint,
): boolean {
  if (!isValidEndpoint(endpoint)) return false;
  const obj = objectMap(doc).get(id);
  if (obj === undefined || obj.get('type') !== 'connector') return false;

  const other = readEndpoint(obj.get(which === 'from' ? 'to' : 'from'));
  if (
    endpoint.kind === 'attached' &&
    other.kind === 'attached' &&
    other.objectId === endpoint.objectId
  ) {
    return false; // both ends on the same object
  }

  const stored: Endpoint =
    endpoint.kind === 'free'
      ? { kind: 'free', x: endpoint.x, y: endpoint.y }
      : {
          kind: 'attached',
          objectId: endpoint.objectId,
          fallback: { x: endpoint.fallback.x, y: endpoint.fallback.y },
        };
  doc.transact(
    () => {
      obj.set(which, stored);
    },
    LOCAL_ORIGIN,
  );
  return true;
}

/**
 * Convert every connector endpoint attached to one of `deletedIds` into a
 * free endpoint at that object's CURRENT side anchor (connector.target_
 * deleted): the arrow stays on the board instead of vanishing.
 *
 * Must run inside an open transaction, BEFORE the objects are removed from
 * the map, so the anchor can still be computed.
 */
export function detachConnectorsTo(doc: Y.Doc, deletedIds: readonly string[]): void {
  if (deletedIds.length === 0) return;
  const gone = new Set(deletedIds);
  const map = objectMap(doc);
  const rects = rectsOfMap(map);

  for (const obj of map.values()) {
    if (obj.get('type') !== 'connector') continue;
    for (const key of ['from', 'to'] as const) {
      const end = readEndpoint(obj.get(key));
      if (end.kind !== 'attached' || !gone.has(end.objectId)) continue;
      const other = readEndpoint(obj.get(key === 'from' ? 'to' : 'from'));
      const resolved = resolveEndpoints(
        key === 'from' ? { from: end, to: other } : { from: other, to: end },
        rects,
      );
      const anchor = key === 'from' ? resolved.from : resolved.to;
      obj.set(key, { kind: 'free', x: anchor.x, y: anchor.y });
    }
  }
}
