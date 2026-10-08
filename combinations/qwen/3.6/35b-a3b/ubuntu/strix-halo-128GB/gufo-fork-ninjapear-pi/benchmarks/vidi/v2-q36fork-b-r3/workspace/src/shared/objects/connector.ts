import * as Y from 'yjs';
import { CONNECTOR_MIN_LENGTH_WORLD } from '../config';
import type { Point } from '../../client/canvas/camera';
import type { Rect } from '../geometry';
import { sideAnchor, nearestSide, resolveEndpoints, AttachedEndpoint, FreeEndpoint, Endpoint, connectorBBox } from '../geometry/connector-geometry';

export interface ConnectorSnap {
  id: string;
  type: 'connector';
  from: Endpoint;
  to: Endpoint;
  x: number;
  y: number;
  width: number;
  height: number;
  z: number;
  createdAt: number;
  createdBy?: string;
}

// ─── Internal helpers ────────────────────────────────────────────────

function getDocObjects(doc: Y.Doc): any {
  return doc.getMap('objects');
}

function getMaxZ(objects: any): number {
  let max = 0;
  for (const val of objects.values()) {
    if (!(val instanceof Y.Map)) continue;
    const z = Number((val as any).get('z') ?? 0);
    if (z > max) max = z;
  }
  return max;
}

function getDataMap(objs: any, id: string): any {
  const val = objs.get(id);
  return val instanceof Y.Map ? val : null;
}

/** Check if an endpoint is free. */
function isFreeEndpoint(e: Endpoint): e is FreeEndpoint {
  return e.kind === 'free';
}

/** Get point coordinates from an endpoint. */
function endpointCoords(e: Endpoint): Point {
  if (isFreeEndpoint(e)) return { x: e.x, y: e.y };
  return e.fallback;
}

// ─── Public API ─────────────────────────────────────────────────────

/**
 * Create a connector between two endpoints.
 *
 * @returns The new connector id, or null if same object or too short (no transaction).
 */
export function createConnector(
  doc: Y.Doc,
  from: Endpoint,
  to: Endpoint,
  by: string,
): string | null {
  // Resolve current coordinates
  const fromPt = endpointCoords(from);
  const toPt = endpointCoords(to);
  const dx = toPt.x - fromPt.x;
  const dy = toPt.y - fromPt.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  // Reject if too short
  if (dist < CONNECTOR_MIN_LENGTH_WORLD) {
    return null;
  }

  // Reject self-connection: both attached and same object
  if (
    from.kind === 'attached' &&
    to.kind === 'attached' &&
    from.objectId === to.objectId
  ) {
    return null;
  }

  const objects = getDocObjects(doc);
  const maxZ = getMaxZ(objects);

  const id = crypto.randomUUID();
  const dataMap = new Y.Map();
  dataMap.set('type', 'connector');
  dataMap.set('from', from);
  dataMap.set('to', to);
  // For connectors, x/y/width/height are stored as 0 and derived via snapshot
  dataMap.set('x', 0);
  dataMap.set('y', 0);
  dataMap.set('width', 0);
  dataMap.set('height', 0);
  dataMap.set('z', maxZ + 1);
  dataMap.set('createdAt', Date.now());
  dataMap.set('createdBy', by);

  doc.transact(() => {
    objects.set(id, dataMap);
  }, undefined);

  return id;
}

/**
 * Set one endpoint of a connector.
 *
 * @returns true on success, false for stale id, non-finite coords, or attaching to opposite end's object.
 */
export function setConnectorEndpoint(
  doc: Y.Doc,
  id: string,
  end: 'from' | 'to',
  e: Endpoint,
): boolean {
  const objects = getDocObjects(doc);
  const dm = getDataMap(objects, id);
  if (!dm) return false;

  // Validate finiteness
  if (e.kind === 'free') {
    if (!Number.isFinite(e.x) || !Number.isFinite(e.y)) return false;
  } else {
    if (!Number.isFinite(e.fallback.x) || !Number.isFinite(e.fallback.y)) return false;
  }

  // Read the opposite endpoint to check for cross-attach BEFORE starting transaction
  const curFrom = dm.get('from');
  const curTo = dm.get('to');

  // Check that it's actually a connector
  if (String(dm.get('type') ?? '') !== 'connector') return false;

  // Reject attaching to the object at the opposite end
  if (end === 'from') {
    if (e.kind === 'attached' && curTo.kind === 'attached' && e.objectId === curTo.objectId) {
      return false;
    }
  } else {
    if (e.kind === 'attached' && curFrom.kind === 'attached' && e.objectId === curFrom.objectId) {
      return false;
    }
  }

  doc.transact(() => {
    if (end === 'from') {
      dm.set('from', e);
    } else {
      dm.set('to', e);
    }
  }, undefined);

  return true;
}

/**
 * Detach all connectors that were attached to any of the given deleted ids.
 * Must be called inside a LOCAL_ORIGIN transaction.
 *
 * After this, the connector is rendered with its endpoints converted to free
 * at the point where they were attached (stored in each Endpoint's fallback).
 */
export function detachConnectorsTo(doc: Y.Doc, deletedIds: string[]): void {
  const objects = getDocObjects(doc);
  const deletedSet = new Set(deletedIds);

  for (const [cid, cval] of objects) {
    if (!(cval instanceof Y.Map)) continue;
    const cm = cval as any;
    if (String(cm.get('type') ?? '') !== 'connector') continue;

    const from: Endpoint = cm.get('from');
    const to: Endpoint = cm.get('to');

    // Detach 'from' endpoint if its target was deleted
    if (from.kind === 'attached' && deletedSet.has(from.objectId)) {
      // Use the stored fallback as the attach-point coordinate
      cm.set('from', { kind: 'free', x: from.fallback.x, y: from.fallback.y });
    }

    // Detach 'to' endpoint if its target was deleted
    if (to.kind === 'attached' && deletedSet.has(to.objectId)) {
      cm.set('to', { kind: 'free', x: to.fallback.x, y: to.fallback.y });
    }
  }
}

/** Return connector snapshots sorted by (z, id). Skips non-connectors. */
export function allConnectorSnapshots(
  doc: Y.Doc,
  rects: ReadonlyMap<string, Rect>,
): readonly ConnectorSnap[] {
  const objects = getDocObjects(doc);
  const result: ConnectorSnap[] = [];

  for (const [id, val] of objects) {
    if (!(val instanceof Y.Map)) continue;
    const dm = val as any;
    const type = String(dm.get('type') ?? '');
    if (type !== 'connector') continue;

    const from: Endpoint = dm.get('from');
    const to: Endpoint = dm.get('to');

    const { from: fromPt, to: toPt } = resolveEndpoints({ from, to }, rects);
    const bbox = connectorBBox(fromPt, toPt);

    result.push({
      id,
      type: 'connector' as const,
      from,
      to,
      x: bbox.x,
      y: bbox.y,
      width: bbox.width,
      height: bbox.height,
      z: Number(dm.get('z') ?? 0),
      createdAt: Number(dm.get('createdAt') ?? 0),
      createdBy: dm.has('createdBy') ? String(dm.get('createdBy')) : undefined,
    });
  }

  result.sort((a, b) => a.z - b.z || a.id.localeCompare(b.id));
  return Object.freeze(result);
}

/** Given a connector snap and rects, compute resolved endpoints. */
export function getResolvedEndpoints(
  snap: ConnectorSnap,
  rects: ReadonlyMap<string, Rect>,
): { from: Point; to: Point } {
  return resolveEndpoints(snap, rects);
}
