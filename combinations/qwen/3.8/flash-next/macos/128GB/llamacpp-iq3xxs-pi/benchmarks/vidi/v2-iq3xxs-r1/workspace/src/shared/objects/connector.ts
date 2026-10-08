import * as Y from 'yjs';
import { LOCAL_ORIGIN, OBJECTS_MAP, objectBounds, type ObjectSnapshot } from '../board-model';
import type { Point, Rect } from '../geometry';
import { CONNECTOR_MIN_LENGTH_WORLD } from '../config';
import {
  connectorBBox,
  nearestSide,
  resolveEndpointPair,
  sideAnchor,
} from '../geometry/connector-geometry';

/**
 * One end of a connector. `attached` remembers the *object* and keeps the point it
 * was attached at as `fallback`, so an arrow whose object vanished (deleted by
 * somebody else mid-drag) is still drawn — at the point where it was (PRD
 * connector.target_deleted). `free` is a plain board point.
 */
export type Endpoint =
  | { kind: 'attached'; objectId: string; fallback: Point }
  | { kind: 'free'; x: number; y: number };

/**
 * An end as a *caller* supplies it. The tools know which object the pointer was on
 * but not which side of it the arrow will join — that is worked out from the other
 * end — so an attached end's `fallback` is filled in by the model on the way in.
 */
export type EndpointInput =
  | { kind: 'attached'; objectId: string; fallback?: Point }
  | { kind: 'free'; x: number; y: number };

/**
 * A connector (arrow) between two points or two objects.
 *
 * Stored schema (`objects/<id>`):
 *   type: 'connector', from, to, x, y, width, height, z, createdAt, createdBy
 *
 * `x/y/width/height` is the box derived from the resolved endpoints — the frame a
 * selection, a marquee or the SVG needs — and `connectorSnapshots` recomputes it on
 * every read, so it never goes stale while an attached object is moved. The stored
 * box is only a fallback for an end whose object is gone.
 */
export interface ConnectorSnap extends ObjectSnapshot {
  type: 'connector';
  from: Endpoint;
  to: Endpoint;
  width: number;
  height: number;
  createdBy: string;
  /**
   * Both ends resolved against the current object rectangles (design
   * `connector.follow`): the line, the arrowhead, the hit test and the selection all
   * use these, so one read of the document cannot disagree with another.
   */
  ends: { from: Point; to: Point };
}

/** Is this snapshot a connector? The registry's hit test asks without importing the class. */
export function isConnectorSnap(obj: ObjectSnapshot): obj is ConnectorSnap {
  return obj.type === 'connector';
}

type AnyMap = Y.Map<unknown>;

function objectsOf(doc: Y.Doc): Y.Map<AnyMap> {
  return doc.getMap<AnyMap>(OBJECTS_MAP);
}

function asFiniteNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function isPoint(value: unknown): value is Point {
  return (
    !!value &&
    typeof value === 'object' &&
    Number.isFinite((value as Point).x) &&
    Number.isFinite((value as Point).y)
  );
}

/**
 * A usable endpoint read out of the document, or null for anything that could not
 * be drawn: a non-finite point, a missing object id, an unknown kind. An attached
 * end with no stored fallback gets (0, 0), so a reader always has a point.
 */
function readEndpoint(value: unknown): Endpoint | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as { kind?: unknown; objectId?: unknown; fallback?: unknown; x?: unknown; y?: unknown };
  if (raw.kind === 'free') {
    return isPoint(raw) ? { kind: 'free', x: raw.x as number, y: raw.y as number } : null;
  }
  if (raw.kind === 'attached') {
    if (typeof raw.objectId !== 'string' || raw.objectId === '') return null;
    return {
      kind: 'attached',
      objectId: raw.objectId,
      fallback: isPoint(raw.fallback) ? { x: (raw.fallback as Point).x, y: (raw.fallback as Point).y } : { x: 0, y: 0 },
    };
  }
  return null;
}

/** The same validation for a caller-supplied endpoint (its fallback may be absent). */
function checkEndpoint(end: EndpointInput): boolean {
  if (!end || typeof end !== 'object') return false;
  if (end.kind === 'free') return Number.isFinite(end.x) && Number.isFinite(end.y);
  if (typeof end.objectId !== 'string' || end.objectId === '') return false;
  // A fallback that is present must be a point; an absent one is filled in below.
  if (end.fallback !== undefined && !isPoint(end.fallback)) return false;
  return true;
}

function readConnector(id: string, m: AnyMap, rects: ReadonlyMap<string, Rect>): ConnectorSnap {
  const from = readEndpoint(m.get('from')) ?? { kind: 'free', x: 0, y: 0 };
  const to = readEndpoint(m.get('to')) ?? { kind: 'free', x: 10, y: 0 };
  const ends = resolveEndpointPair({ from, to }, rects);
  const box = connectorBBox(ends.from, ends.to);
  const createdBy = m.get('createdBy');
  return {
    id,
    type: 'connector',
    from,
    to,
    ends,
    // The stored box is the fallback; the derived one wins while objects exist.
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    z: asFiniteNumber(m.get('z')),
    createdBy: typeof createdBy === 'string' ? createdBy : '',
  };
}

/**
 * Every object an arrow may attach to, as a rectangle by id — stickies, text and
 * shapes, at the sizes story 7 gave them. Connectors are left out: an arrow whose
 * ends are other arrows would chase its own tail.
 */
export function connectorRects(doc: Y.Doc): Map<string, Rect> {
  const rects = new Map<string, Rect>();
  for (const [id, m] of objectsOf(doc)) {
    if (!(m instanceof Y.Map)) continue;
    const type = m.get('type');
    if (type === 'connector') continue;
    rects.set(
      id,
      objectBounds({
        id,
        type: typeof type === 'string' ? type : 'unknown',
        x: asFiniteNumber(m.get('x')),
        y: asFiniteNumber(m.get('y')),
        z: asFiniteNumber(m.get('z')),
        width: typeof m.get('width') === 'number' ? (m.get('width') as number) : undefined,
        height: typeof m.get('height') === 'number' ? (m.get('height') as number) : undefined,
      }),
    );
  }
  return rects;
}

function maxZ(doc: Y.Doc): number {
  let max = 0;
  for (const m of objectsOf(doc).values()) {
    if (m instanceof Y.Map) max = Math.max(max, asFiniteNumber(m.get('z')));
  }
  return max;
}

/**
 * Every connector on the board in paint order, each with its ends resolved and its
 * box derived from them, so a moved object moves the arrow on every screen
 * (PRD connector.follow) with no extra traffic.
 */
export function connectorSnapshots(doc: Y.Doc): readonly ConnectorSnap[] {
  const rects = connectorRects(doc);
  const out: ConnectorSnap[] = [];
  for (const [id, m] of objectsOf(doc)) {
    if (!(m instanceof Y.Map)) continue;
    if (m.get('type') !== 'connector') continue;
    out.push(readConnector(id, m, rects));
  }
  out.sort((a, b) => a.z - b.z || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return out;
}

function connectorMap(doc: Y.Doc, id: string): AnyMap | undefined {
  const m = objectsOf(doc).get(id);
  if (!(m instanceof Y.Map)) return undefined;
  if (m.get('type') !== 'connector') return undefined;
  return m;
}

function sameEndpoint(a: Endpoint | EndpointInput, b: Endpoint | EndpointInput): boolean {
  if (a.kind === 'free' && b.kind === 'free') return a.x === b.x && a.y === b.y;
  if (a.kind === 'attached' && b.kind === 'attached') return a.objectId === b.objectId;
  return false;
}

/** An attached end's stored fallback: the anchor it is drawn at right now. */
function withFallback(
  end: Endpoint | EndpointInput,
  rects: ReadonlyMap<string, Rect>,
  toward: Point,
): Endpoint {
  if (end.kind === 'free') return end;
  const r = rects.get(end.objectId);
  if (!r) return { ...end, fallback: end.fallback ?? { x: 0, y: 0 } };
  return { ...end, fallback: sideAnchor(r, nearestSide(r, toward)) };
}

/**
 * Draw an arrow (PRD connector.create_attached, connector.create_free,
 * connector.no_accidental).
 *
 * Each end is stored as given: `attached` for the object the drag started or ended
 * on (with the side anchor facing the other end kept as `fallback`), `free` for a
 * point of empty board.
 *
 * Returns the new id, or `null` — writing nothing — when an end is malformed, when
 * both ends attach to the same object, or when the resolved arrow is shorter than
 * `CONNECTOR_MIN_LENGTH_WORLD` (a stray click, not a drawn arrow).
 */
export function createConnector(
  doc: Y.Doc,
  from: EndpointInput,
  to: EndpointInput,
  by: string,
): string | null {
  if (!checkEndpoint(from) || !checkEndpoint(to)) return null;
  const attachedFrom = from.kind === 'attached' ? from.objectId : null;
  const attachedTo = to.kind === 'attached' ? to.objectId : null;
  if (attachedFrom !== null && attachedFrom === attachedTo) return null;

  const rects = connectorRects(doc);
  const ends = resolveEndpointPair({ from, to }, rects);
  const length = Math.hypot(ends.to.x - ends.from.x, ends.to.y - ends.from.y);
  if (!(length >= CONNECTOR_MIN_LENGTH_WORLD)) return null;

  const storedFrom = withFallback(from, rects, { x: ends.to.x, y: ends.to.y });
  const storedTo = withFallback(to, rects, { x: ends.from.x, y: ends.from.y });
  const box = connectorBBox(ends.from, ends.to);
  const id = crypto.randomUUID();
  const z = maxZ(doc) + 1;
  const createdAt = Date.now();
  doc.transact(() => {
    const m = new Y.Map<unknown>();
    m.set('type', 'connector');
    m.set('from', storedFrom);
    m.set('to', storedTo);
    m.set('x', box.x);
    m.set('y', box.y);
    m.set('width', box.width);
    m.set('height', box.height);
    m.set('z', z);
    m.set('createdAt', createdAt);
    m.set('createdBy', typeof by === 'string' ? by : '');
    objectsOf(doc).set(id, m);
  }, LOCAL_ORIGIN);
  return id;
}

/**
 * Move one end of an arrow (PRD connector.reattach): onto another object, or onto
 * empty board space, which fixes it there.
 *
 * False, and no transaction, for a stale id, a malformed end, a no-op, or an end
 * aimed at the object the *other* end is attached to — the handle snaps back
 * instead of folding the arrow onto one object.
 */
export function setConnectorEndpoint(
  doc: Y.Doc,
  id: string,
  end: 'from' | 'to',
  e: EndpointInput,
): boolean {
  const m = connectorMap(doc, id);
  if (!m) return false;
  if (!checkEndpoint(e)) return false;

  const current = readConnector(id, m, connectorRects(doc));
  const other = end === 'from' ? current.to : current.from;
  if (e.kind === 'attached' && other.kind === 'attached' && e.objectId === other.objectId) {
    return false;
  }
  if (sameEndpoint(end === 'from' ? current.from : current.to, e)) return false;

  // An attached end keeps the anchor it was released at as its fallback, so the
  // arrow is still drawn if that object disappears later.
  const rects = connectorRects(doc);
  const currentEnds = resolveEndpointPair({ from: current.from, to: current.to }, rects);
  const otherPoint = end === 'from' ? currentEnds.to : currentEnds.from;
  const stored = withFallback(e, rects, otherPoint);
  const next = nextPair(end, current, stored);
  const nextEnds = resolveEndpointPair(next, rects);
  const box = connectorBBox(nextEnds.from, nextEnds.to);

  doc.transact(() => {
    m.set(end, stored);
    m.set('x', box.x);
    m.set('y', box.y);
    m.set('width', box.width);
    m.set('height', box.height);
  }, LOCAL_ORIGIN);
  return true;
}

/** The two ends as a pair, with one of them replaced. */
function nextPair(
  end: 'from' | 'to',
  current: { from: Endpoint; to: Endpoint },
  stored: Endpoint,
): { from: Endpoint; to: Endpoint } {
  return end === 'from' ? { from: stored, to: current.to } : { from: current.from, to: stored };
}

/**
 * Fix every arrow end that pointed at a deleted object at the point it was attached
 * at, so the arrow survives its object (PRD connector.target_deleted).
 *
 * Called from story 7's `deleteObjects` *inside* that transaction: one update, so
 * one Undo puts the object and its arrows back together. Call it while the objects
 * are still in the document — that is what makes the point where the arrow was
 * attached the right one.
 */
export function detachConnectorsTo(doc: Y.Doc, deletedIds: string[]): void {
  const doomed = new Set(deletedIds);
  if (doomed.size === 0) return;
  const objs = objectsOf(doc);
  const rects = connectorRects(doc);
  for (const [id, m] of objs) {
    if (!(m instanceof Y.Map)) continue;
    if (m.get('type') !== 'connector') continue;
    if (doomed.has(id)) continue; // it is going away itself
    const current = readConnector(id, m, rects);
    const currentEnds = resolveEndpointPair({ from: current.from, to: current.to }, rects);
    const next: { from: Endpoint; to: Endpoint } = { from: current.from, to: current.to };
    let changed = false;
    for (const end of ['from', 'to'] as const) {
      const e = current[end];
      if (e.kind !== 'attached' || !doomed.has(e.objectId)) continue;
      // The point it was attached at, fixed in place (PRD connector.target_deleted).
      const anchor = currentEnds[end];
      next[end] = { kind: 'free', x: anchor.x, y: anchor.y };
      changed = true;
    }
    if (!changed) continue;
    const nextEnds = resolveEndpointPair(next, rects);
    const box = connectorBBox(nextEnds.from, nextEnds.to);
    m.set('from', next.from);
    m.set('to', next.to);
    m.set('x', box.x);
    m.set('y', box.y);
    m.set('width', box.width);
    m.set('height', box.height);
  }
}
