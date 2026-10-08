/**
 * Connector object model (story 10, connector.object): the 'connector'
 * object type is an arrow between two endpoints. Each endpoint is either
 * free (a stored point) or attached to an object id, with a stored
 * fallback point (the last known anchor) for rendering when the target no
 * longer exists (concurrent-delete orphan).
 *
 * Connector entries store x/y as 0; their snapshot bounding box is derived
 * (board-model's snapshotAll: resolveEndpoints + connectorBBox), so
 * marquee containment and selection unions work like any other object.
 *
 * This module is the single owner of the 'connector' schema and every
 * connector mutation, exactly like shape.ts. It registers 'connector' as a
 * known object type on import, and registers `detachConnectorsTo` as a
 * pre-delete hook so board-model's deleteObjects detaches connector ends in
 * the same transaction (board-model never imports this module — the hook
 * registry keeps the dependency one-way and cycle-free).
 *
 * The `Endpoint` type and its (de)serialization live in the leaf module
 * shared/objects/endpoint and are re-exported here (design contract).
 */

import * as Y from 'yjs';
import {
  addKnownObjectType,
  addPreDeleteHook,
  LOCAL_ORIGIN,
  maxZ,
  objectRects,
} from '../board-model';
import { CONNECTOR_MIN_LENGTH_WORLD } from '../config';
import {
  nearestSide,
  resolveEndpoints,
  sideAnchor,
} from '../geometry/connector-geometry';
import {
  endpointRef,
  isValidEndpoint,
  readEndpoint,
  writeEndpoint,
  type Endpoint,
} from './endpoint';

export type { Endpoint } from './endpoint';
export { isValidEndpoint, readEndpoint, writeEndpoint } from './endpoint';

// The connector model owns the 'connector' type for the document layer
// (idempotent; the client registry registers it again when it loads).
addKnownObjectType('connector');

/** Arguments for createConnector. */
export interface CreateConnectorArgs {
  from: Endpoint;
  to: Endpoint;
}

/** The 'connector' entry for `id`, or undefined for stale ids / other types. */
export function connectorEntry(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  const entry = doc.getMap('objects').get(id);
  if (entry instanceof Y.Map && entry.get('type') === 'connector') {
    return entry;
  }
  return undefined;
}

/**
 * Creates a connector between two endpoints, on top of all other objects.
 * One LOCAL_ORIGIN transaction.
 *
 * Returns the new id, or null (no transaction) when:
 * - an endpoint is malformed (non-finite free point / bad attached shape);
 * - both endpoints attach to the same object;
 * - the resolved length (live target side anchors, or fallbacks for
 *   missing targets) is below CONNECTOR_MIN_LENGTH_WORLD.
 */
export function createConnector(
  doc: Y.Doc,
  args: CreateConnectorArgs,
  createdBy: string,
): string | null {
  if (!isValidEndpoint(args.from) || !isValidEndpoint(args.to)) {
    return null;
  }
  if (
    args.from.kind === 'attached' &&
    args.to.kind === 'attached' &&
    args.from.objectId === args.to.objectId
  ) {
    return null; // a connector between the two ends of the same object is invalid
  }
  if (typeof createdBy !== 'string') {
    return null;
  }
  const rects = objectRects(doc);
  const { fromPoint, toPoint } = resolveEndpoints({ from: args.from, to: args.to }, rects);
  const length = Math.hypot(toPoint.x - fromPoint.x, toPoint.y - fromPoint.y);
  if (!Number.isFinite(length) || length < CONNECTOR_MIN_LENGTH_WORLD) {
    return null;
  }
  const id = crypto.randomUUID();
  doc.transact(
    () => {
      const entry = new Y.Map();
      entry.set('type', 'connector');
      // x/y are stored as 0; the snapshot derives the bounding box from the
      // resolved endpoints (design connector.object).
      entry.set('x', 0);
      entry.set('y', 0);
      const from = new Y.Map();
      writeEndpoint(from, args.from);
      const to = new Y.Map();
      writeEndpoint(to, args.to);
      entry.set('from', from);
      entry.set('to', to);
      entry.set('z', maxZ(doc) + 1);
      entry.set('createdAt', Date.now());
      entry.set('createdBy', createdBy);
      doc.getMap('objects').set(id, entry);
    },
    LOCAL_ORIGIN,
  );
  return id;
}

/**
 * Re-sets one endpoint of a connector (the Select-tool re-attach gesture,
 * story 10): free at a point, or attached to a (different) object. One
 * LOCAL_ORIGIN transaction.
 *
 * Returns false (no transaction) for stale ids / non-connectors, malformed
 * endpoints, or when the endpoint would attach to the object already held
 * by the opposite end.
 */
export function setConnectorEndpoint(
  doc: Y.Doc,
  id: string,
  end: 'from' | 'to',
  e: Endpoint,
): boolean {
  const entry = connectorEntry(doc, id);
  if (entry === undefined || !isValidEndpoint(e)) {
    return false;
  }
  const other = readEndpoint(entry.get(end === 'from' ? 'to' : 'from'));
  if (other === undefined) {
    return false; // malformed opposite end: leave the connector alone
  }
  if (e.kind === 'attached' && other.kind === 'attached' && e.objectId === other.objectId) {
    return false; // same object on both ends
  }
  doc.transact(
    () => {
      const target = entry.get(end);
      if (target instanceof Y.Map) {
        writeEndpoint(target, e);
      }
    },
    LOCAL_ORIGIN,
  );
  return true;
}

/**
 * Converts every connector endpoint attached to one of `deletedIds` into a
 * free endpoint at its last known anchor (the deleted object's side anchor
 * facing the other endpoint).
 *
 * MUST be called inside an already-open transaction: this function writes
 * directly and never opens a transaction of its own. board-model's
 * deleteObjects invokes it via the pre-delete hook (registered below)
 * before the removals, so the whole deletion is still exactly one update
 * and the deleted objects' rects are still live.
 */
export function detachConnectorsTo(doc: Y.Doc, deletedIds: readonly string[]): void {
  if (deletedIds.length === 0) {
    return;
  }
  const deleted = new Set(deletedIds);
  const rects = objectRects(doc);
  for (const [, entry] of doc.getMap('objects')) {
    if (!(entry instanceof Y.Map) || entry.get('type') !== 'connector') {
      continue;
    }
    for (const key of ['from', 'to'] as const) {
      const endMap = entry.get(key);
      if (!(endMap instanceof Y.Map)) {
        continue;
      }
      const ep = readEndpoint(endMap);
      if (ep === undefined || ep.kind !== 'attached' || !deleted.has(ep.objectId)) {
        continue;
      }
      const other = readEndpoint(entry.get(key === 'from' ? 'to' : 'from'));
      if (other === undefined) {
        continue;
      }
      const rect = rects.get(ep.objectId);
      const fallback =
        rect !== undefined
          ? sideAnchor(rect, nearestSide(rect, endpointRef(other, rects)))
          : { x: ep.fallback.x, y: ep.fallback.y };
      writeEndpoint(endMap, { kind: 'free', x: fallback.x, y: fallback.y });
    }
  }
}

// Keep board-model free of any import of this module: the hook runs inside
// deleteObjects' transaction, before the removals.
addPreDeleteHook(detachConnectorsTo);
