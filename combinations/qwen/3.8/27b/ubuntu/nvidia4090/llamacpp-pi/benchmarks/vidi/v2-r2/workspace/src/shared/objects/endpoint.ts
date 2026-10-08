/**
 * Connector endpoint serialization (story 10): the `Endpoint` descriptor and
 * its Y.Map (de)serialization.
 *
 * This is a leaf module (Yjs + geometry types only): board-model reads
 * endpoints while snapshotting connectors without importing the connector
 * model, and the connector model (shared/objects/connector) re-exports
 * everything here so the design contract holds.
 */

import * as Y from 'yjs';
import type { Point, Rect } from '../geometry';

/** One end of a connector: a free point, or an attachment to an object
 *  with a fallback anchor (last known position of the target's side
 *  anchor) for orphan rendering. */
export type Endpoint =
  | { kind: 'free'; x: number; y: number }
  | { kind: 'attached'; objectId: string; fallback: Point };

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function finitePoint(p: unknown): p is Point {
  return (
    typeof p === 'object' &&
    p !== null &&
    finiteNumber((p as Point).x) &&
    finiteNumber((p as Point).y)
  );
}

/** True for a well-formed endpoint (free: finite point; attached: string
 *  id + finite fallback). */
export function isValidEndpoint(e: unknown): e is Endpoint {
  if (typeof e !== 'object' || e === null) {
    return false;
  }
  const ep = e as Endpoint;
  if (ep.kind === 'free') {
    return finiteNumber(ep.x) && finiteNumber(ep.y);
  }
  if (ep.kind === 'attached') {
    return typeof ep.objectId === 'string' && ep.objectId.length > 0 && finitePoint(ep.fallback);
  }
  return false;
}

/** Reads one endpoint Y.Map into a well-formed Endpoint (undefined when
 *  malformed). */
export function readEndpoint(map: unknown): Endpoint | undefined {
  if (!(map instanceof Y.Map)) {
    return undefined;
  }
  const kind = map.get('kind');
  if (kind === 'free') {
    const x = map.get('x');
    const y = map.get('y');
    if (finiteNumber(x) && finiteNumber(y)) {
      return { kind: 'free', x, y };
    }
    return undefined;
  }
  if (kind === 'attached') {
    const objectId = map.get('objectId');
    const fallbackX = map.get('fallbackX');
    const fallbackY = map.get('fallbackY');
    if (
      typeof objectId === 'string' &&
      objectId.length > 0 &&
      finiteNumber(fallbackX) &&
      finiteNumber(fallbackY)
    ) {
      return { kind: 'attached', objectId, fallback: { x: fallbackX, y: fallbackY } };
    }
    return undefined;
  }
  return undefined;
}

/** Writes an endpoint into its Y.Map, clearing the fields of the other
 *  flavour so a free<->attached flip never leaves stale fields behind. */
export function writeEndpoint(map: Y.Map<unknown>, e: Endpoint): void {
  if (e.kind === 'free') {
    map.set('kind', 'free');
    map.set('x', e.x);
    map.set('y', e.y);
    map.delete('objectId');
    map.delete('fallbackX');
    map.delete('fallbackY');
  } else {
    map.set('kind', 'attached');
    map.set('objectId', e.objectId);
    map.set('fallbackX', e.fallback.x);
    map.set('fallbackY', e.fallback.y);
    map.delete('x');
    map.delete('y');
  }
}

/**
 * The reference point an endpoint stands for, as seen from the *other*
 * endpoint's side selection: a free point, the live target rect centre,
 * or the stored fallback (target already deleted).
 */
export function endpointRef(end: Endpoint, rects: ReadonlyMap<string, Rect>): Point {
  if (end.kind === 'free') {
    return { x: end.x, y: end.y };
  }
  const rect = rects.get(end.objectId);
  if (rect !== undefined) {
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  }
  return { x: end.fallback.x, y: end.fallback.y };
}
