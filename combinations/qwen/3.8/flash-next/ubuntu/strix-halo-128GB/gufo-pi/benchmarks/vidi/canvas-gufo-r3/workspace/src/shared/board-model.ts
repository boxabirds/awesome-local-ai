import * as Y from 'yjs';
import { StickyColor, STICKY_COLORS, STICKY_SIZE_WORLD, DEFAULT_STICKY_COLOR } from './config';
import { Rect } from './geometry';
import type { TextSnapshot } from './objects/text';
import { snapshotText } from './objects/text';
import type { ShapeSnap } from './objects/shape';
import { snapshotShape } from './objects/shape';
import type { ConnectorSnap } from './objects/connector';
import { detachConnectorsTo, snapshotConnector } from './objects/connector';
import type { StrokeSnap } from './objects/stroke';
import { snapshotStroke } from './objects/stroke';
export type { ShapeSnap } from './objects/shape';
export type { ConnectorSnap, Endpoint } from './objects/connector';
export type { StrokeSnap } from './objects/stroke';

export const LOCAL_ORIGIN: unique symbol = Symbol('local');

export interface StickySnapshot {
  id: string;
  type: 'sticky';
  x: number;
  y: number;
  color: StickyColor;
  text: string;
  z: number;
  createdAt: number;
  width?: number;
  height?: number;
}

export type ObjectSnapshot = StickySnapshot | TextSnapshot | ShapeSnap | ConnectorSnap | StrokeSnap;

function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects');
}

function getStickyMap(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  const m = objectsMap(doc).get(id);
  if (!m || !(m instanceof Y.Map) || m.get('type') !== 'sticky') return undefined;
  return m;
}

function isStickyColor(value: string): value is StickyColor {
  return Object.prototype.hasOwnProperty.call(STICKY_COLORS, value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function maxZ(doc: Y.Doc): number {
  let max = 0;
  objectsMap(doc).forEach((m) => {
    if (m instanceof Y.Map && m.get('type') === 'sticky') {
      const z = m.get('z');
      if (isFiniteNumber(z) && z > max) max = z;
    }
  });
  return max;
}

/** Sets meta.schemaVersion if absent. Idempotent, emits no update when already set. */
export function initDoc(doc: Y.Doc): void {
  const meta = doc.getMap('meta');
  if (!meta.has('schemaVersion')) {
    doc.transact(() => {
      if (!meta.has('schemaVersion')) meta.set('schemaVersion', 1);
    }, LOCAL_ORIGIN);
  }
}

/**
 * Creates a sticky note centred on the world point `at`
 * (stored top-left = at - STICKY_SIZE_WORLD / 2), on top of all other notes.
 * Returns the new id, or '' if the point is invalid.
 */
export function createSticky(doc: Y.Doc, at: { x: number; y: number }, color: StickyColor = DEFAULT_STICKY_COLOR): string {
  if (!at || !isFiniteNumber(at.x) || !isFiniteNumber(at.y)) return '';
  if (!isStickyColor(color)) return '';
  const id = crypto.randomUUID();
  doc.transact(() => {
    const m = new Y.Map<unknown>();
    m.set('type', 'sticky');
    m.set('x', at.x - STICKY_SIZE_WORLD / 2);
    m.set('y', at.y - STICKY_SIZE_WORLD / 2);
    m.set('color', color);
    m.set('text', new Y.Text());
    m.set('z', maxZ(doc) + 1);
    m.set('createdAt', Date.now());
    objectsMap(doc).set(id, m);
  }, LOCAL_ORIGIN);
  return id;
}

/** Moves the note's top-left to (x, y) world units. */
export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  const m = getStickyMap(doc, id);
  if (!m) return false;
  if (!isFiniteNumber(x) || !isFiniteNumber(y)) return false;
  doc.transact(() => {
    m.set('x', x);
    m.set('y', y);
  }, LOCAL_ORIGIN);
  return true;
}

/** Raises the note above all others. No-op (false) when already topmost. */
export function bringToFront(doc: Y.Doc, id: string): boolean {
  const m = getStickyMap(doc, id);
  if (!m) return false;
  const z = m.get('z');
  const max = maxZ(doc);
  if (!isFiniteNumber(z) || z >= max) return false;
  doc.transact(() => {
    m.set('z', max + 1);
  }, LOCAL_ORIGIN);
  return true;
}

/** Sets the note colour. Rejects unknown colour names and stale ids. */
export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  const m = getStickyMap(doc, id);
  if (!m) return false;
  if (!isStickyColor(color)) return false;
  if (m.get('color') === color) return false;
  doc.transact(() => {
    m.set('color', color);
  }, LOCAL_ORIGIN);
  return true;
}

/** Removes the note from the board. Releases any connector attached to it (same transaction). */
export function deleteObject(doc: Y.Doc, id: string): boolean {
  const m = getStickyMap(doc, id);
  if (!m) return false;
  doc.transact(() => {
    detachConnectorsTo(doc, [id]);
    objectsMap(doc).delete(id);
  }, LOCAL_ORIGIN);
  return true;
}

// --- Story 7: group operations ---

function getObjectMap(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  const m = objectsMap(doc).get(id);
  if (!m || !(m instanceof Y.Map)) return undefined;
  return m;
}

/** Returns the bounds rect for an object snapshot (width/height fallback to STICKY_SIZE_WORLD). */
export function objectBounds(obj: ObjectSnapshot): Rect {
  return {
    x: obj.x,
    y: obj.y,
    width: obj.width ?? STICKY_SIZE_WORLD,
    height: obj.height ?? STICKY_SIZE_WORLD,
  };
}

/** Returns ids of objects entirely inside the given rect. */
export function objectsInRect(snapshots: readonly ObjectSnapshot[], rect: Rect): string[] {
  const result: string[] = [];
  for (const obj of snapshots) {
    const b = objectBounds(obj);
    if (
      b.x >= rect.x &&
      b.y >= rect.y &&
      b.x + b.width <= rect.x + rect.width &&
      b.y + b.height <= rect.y + rect.height
    ) {
      result.push(obj.id);
    }
  }
  return result;
}

/** Returns all object ids from the snapshot (already filtered to registered types by snapshot()). */
export function allObjectIds(snapshots: readonly ObjectSnapshot[]): string[] {
  return snapshots.map((s) => s.id);
}

/**
 * Move multiple objects to absolute positions. Skips missing ids and non-finite values.
 * Returns the count of objects actually moved. Emits at most one transaction.
 */
export function moveObjects(doc: Y.Doc, positions: ReadonlyMap<string, { x: number; y: number }>): number {
  if (positions.size === 0) return 0;
  // Validate: if any non-finite value is in the map, reject the whole operation
  for (const pos of positions.values()) {
    if (!isFiniteNumber(pos.x) || !isFiniteNumber(pos.y)) return 0;
  }
  // Gather valid maps first
  const valid: Array<{ m: Y.Map<unknown>; x: number; y: number }> = [];
  for (const [id, pos] of positions) {
    const m = getObjectMap(doc, id);
    if (m) valid.push({ m, x: pos.x, y: pos.y });
  }
  if (valid.length === 0) return 0;
  doc.transact(() => {
    for (const { m, x, y } of valid) {
      m.set('x', x);
      m.set('y', y);
    }
  }, LOCAL_ORIGIN);
  return valid.length;
}

/**
 * Resize multiple objects to absolute rects. Skips missing ids and non-finite values.
 * Returns the count of objects actually resized. Emits at most one transaction.
 */
export function resizeObjects(doc: Y.Doc, rects: ReadonlyMap<string, Rect>): number {
  if (rects.size === 0) return 0;
  // Validate all values are finite
  for (const r of rects.values()) {
    if (!isFiniteNumber(r.x) || !isFiniteNumber(r.y) || !isFiniteNumber(r.width) || !isFiniteNumber(r.height)) return 0;
  }
  const valid: Array<{ m: Y.Map<unknown>; r: Rect }> = [];
  for (const [id, r] of rects) {
    const m = getObjectMap(doc, id);
    if (m) valid.push({ m, r });
  }
  if (valid.length === 0) return 0;
  doc.transact(() => {
    for (const { m, r } of valid) {
      m.set('x', r.x);
      m.set('y', r.y);
      m.set('width', r.width);
      m.set('height', r.height);
    }
  }, LOCAL_ORIGIN);
  return valid.length;
}

/**
 * Bring multiple objects to front. All selected objects are placed above all unselected
 * objects while preserving their relative z-order among themselves.
 * Returns the count of objects actually changed. Emits at most one transaction.
 */
export function bringObjectsToFront(doc: Y.Doc, ids: readonly string[]): number {
  if (ids.length === 0) return 0;
  const idSet = new Set(ids);
  let maxUnselectedZ = 0;
  const selected: Array<{ m: Y.Map<unknown>; z: number }> = [];

  objectsMap(doc).forEach((m, id) => {
    if (!(m instanceof Y.Map)) return;
    const z = m.get('z');
    if (!isFiniteNumber(z)) return;
    if (idSet.has(id)) {
      selected.push({ m, z });
    } else {
      if (z > maxUnselectedZ) maxUnselectedZ = z;
    }
  });

  if (selected.length === 0) return 0;

  // Sort selected by their current z to preserve relative order
  selected.sort((a, b) => a.z - b.z);

  // Check if any actually need to change
  let changed = 0;
  doc.transact(() => {
    for (let i = 0; i < selected.length; i++) {
      const newZ = maxUnselectedZ + i + 1;
      if (selected[i].z !== newZ) {
        selected[i].m.set('z', newZ);
        changed++;
      }
    }
  }, LOCAL_ORIGIN);
  return changed;
}

/**
 * Delete multiple objects. Skips missing ids.
 * Returns the count actually deleted. Emits at most one transaction.
 */
export function deleteObjects(doc: Y.Doc, ids: readonly string[]): number {
  if (ids.length === 0) return 0;
  const existing: string[] = [];
  for (const id of ids) {
    if (objectsMap(doc).has(id)) existing.push(id);
  }
  if (existing.length === 0) return 0;
  doc.transact(() => {
    // Release connectors attached to any deleted object first, inside the same
    // transaction, so every participant sees the arrow detach rather than vanish.
    detachConnectorsTo(doc, existing);
    for (const id of existing) {
      objectsMap(doc).delete(id);
    }
  }, LOCAL_ORIGIN);
  return existing.length;
}

export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const m = getStickyMap(doc, id);
  if (!m) return undefined;
  const t = m.get('text');
  return t instanceof Y.Text ? t : undefined;
}

/** Immutable snapshot of all sticky notes sorted by (z, id); unknown types skipped. */
export function snapshot(doc: Y.Doc): readonly StickySnapshot[] {
  const result: StickySnapshot[] = [];
  objectsMap(doc).forEach((m, id) => {
    if (!(m instanceof Y.Map) || m.get('type') !== 'sticky') return;
    const x = m.get('x');
    const y = m.get('y');
    const color = m.get('color');
    const text = m.get('text');
    const z = m.get('z');
    const createdAt = m.get('createdAt');
    if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(z)) return;
    const width = m.get('width');
    const height = m.get('height');
    result.push({
      id,
      type: 'sticky',
      x,
      y,
      color: isStickyColor(String(color)) ? (color as StickyColor) : DEFAULT_STICKY_COLOR,
      text: text instanceof Y.Text ? text.toString() : '',
      z,
      createdAt: isFiniteNumber(createdAt) ? createdAt : 0,
      ...(isFiniteNumber(width) ? { width } : {}),
      ...(isFiniteNumber(height) ? { height } : {}),
    });
  });
  result.sort((a, b) => (a.z - b.z) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return result;
}

/** Immutable snapshot of all objects (stickies + text + shapes + connectors) sorted by (z, id). */
export function snapshotAll(doc: Y.Doc): readonly ObjectSnapshot[] {
  const stickies: readonly StickySnapshot[] = snapshot(doc);
  const texts: readonly TextSnapshot[] = snapshotText(doc);
  const shapes: readonly ShapeSnap[] = snapshotShape(doc);
  const connectors: readonly ConnectorSnap[] = snapshotConnector(doc);
  const strokes: readonly StrokeSnap[] = snapshotStroke(doc);
  const all = [...stickies, ...texts, ...shapes, ...connectors, ...strokes] as ObjectSnapshot[];
  all.sort((a, b) => (a.z - b.z) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return all;
}

/** Rect of any non-connector board object by id, or null when absent/degenerate. */
export function getObjectRect(doc: Y.Doc, id: string): Rect | null {
  const m = objectsMap(doc).get(id);
  if (!(m instanceof Y.Map)) return null;
  const x = m.get('x');
  const y = m.get('y');
  if (!isFiniteNumber(x) || !isFiniteNumber(y)) return null;
  const type = m.get('type');
  if (type === 'connector') return null;
  let width = m.get('width');
  let height = m.get('height');
  if (type === 'sticky') {
    if (!isFiniteNumber(width)) width = STICKY_SIZE_WORLD;
    if (!isFiniteNumber(height)) height = STICKY_SIZE_WORLD;
  }
  if (!isFiniteNumber(width) || !isFiniteNumber(height)) return null;
  return { x, y, width, height };
}
