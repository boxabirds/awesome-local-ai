import * as Y from 'yjs';
import {
  STICKY_COLORS,
  STICKY_SIZE_WORLD,
  DEFAULT_STICKY_COLOR,
  type StickyColor,
} from './config';

// Local change origin. Story 8 (undo) uses it to filter the user's own changes
// and story 3 (sync) uses it to avoid echoing local edits back.
export const LOCAL_ORIGIN = Symbol('vidi6-local-origin');
export type LocalOrigin = typeof LOCAL_ORIGIN;

export interface StickySnapshot {
  id: string;
  type: 'sticky';
  x: number;
  y: number;
  color: StickyColor;
  text: string;
  z: number;
  createdAt: number;
}

const SCHEMA_VERSION = 1;

type ObjectMap = Y.Map<unknown>;

function objectsOf(doc: Y.Doc): Y.Map<ObjectMap> {
  return doc.getMap<ObjectMap>('objects');
}

function stickyOf(doc: Y.Doc, id: string): ObjectMap | undefined {
  const obj = objectsOf(doc).get(id);
  return obj instanceof Y.Map ? obj : undefined;
}

function isValidColor(color: unknown): color is StickyColor {
  return typeof color === 'string' && color in STICKY_COLORS;
}

function isFinitePoint(p: { x: number; y: number }): boolean {
  return Number.isFinite(p.x) && Number.isFinite(p.y);
}

function maxZ(objects: Y.Map<ObjectMap>): number {
  let max = 0;
  objects.forEach((obj) => {
    if (!(obj instanceof Y.Map)) return;
    const z = obj.get('z');
    if (typeof z === 'number' && z > max) max = z;
  });
  return max;
}

/**
 * Sets meta.schemaVersion if absent. Idempotent; safe to call on a doc that
 * already carries the schema (e.g. after story 4 loads persisted state).
 */
export function initDoc(doc: Y.Doc): void {
  const meta = doc.getMap('meta');
  if (!meta.has('schemaVersion')) {
    meta.set('schemaVersion', SCHEMA_VERSION);
  }
}

/**
 * Creates a sticky note centred on `at` (world units, top-left = at - size/2),
 * on top of all other notes, in the given colour (default yellow).
 * Returns the new id, or null for non-finite coordinates / unknown colour.
 */
export function createSticky(
  doc: Y.Doc,
  at: { x: number; y: number },
  color: StickyColor = DEFAULT_STICKY_COLOR,
): string | null {
  if (!isFinitePoint(at) || !isValidColor(color)) return null;
  const id = crypto.randomUUID();
  doc.transact(() => {
    const objects = objectsOf(doc);
    const obj = new Y.Map();
    obj.set('type', 'sticky');
    obj.set('x', at.x - STICKY_SIZE_WORLD / 2);
    obj.set('y', at.y - STICKY_SIZE_WORLD / 2);
    obj.set('color', color);
    obj.set('text', new Y.Text());
    obj.set('z', maxZ(objects) + 1);
    obj.set('createdAt', Date.now());
    objects.set(id, obj);
  }, LOCAL_ORIGIN);
  return id;
}

/**
 * Moves a note's top-left to world (x, y). Returns true when a change was
 * applied; false for a stale id, non-finite coordinates, or a no-op move.
 */
export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  const obj = stickyOf(doc, id);
  if (!obj) return false;
  if (obj.get('x') === x && obj.get('y') === y) return false;
  doc.transact(() => {
    obj.set('x', x);
    obj.set('y', y);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Brings a note to the top of the stacking order (z = maxZ + 1).
 * Returns false (no update) for a stale id or a note already on top.
 */
export function bringToFront(doc: Y.Doc, id: string): boolean {
  const obj = stickyOf(doc, id);
  if (!obj) return false;
  const z = obj.get('z');
  if (typeof z !== 'number') return false;
  if (z >= maxZ(objectsOf(doc))) return false;
  doc.transact(() => {
    obj.set('z', maxZ(objectsOf(doc)) + 1);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Changes a note's colour. Returns false (no update) for a stale id, an
 * unknown colour, or the colour the note already has.
 */
export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  if (!isValidColor(color)) return false;
  const obj = stickyOf(doc, id);
  if (!obj) return false;
  if (obj.get('color') === color) return false;
  doc.transact(() => {
    obj.set('color', color);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Removes a note from the doc. Returns false (no update) for a stale id.
 */
export function deleteObject(doc: Y.Doc, id: string): boolean {
  if (!stickyOf(doc, id)) return false;
  doc.transact(() => {
    objectsOf(doc).delete(id);
  }, LOCAL_ORIGIN);
  return true;
}

/** Returns the note's Y.Text, or undefined for a stale id. */
export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const obj = stickyOf(doc, id);
  if (!obj) return undefined;
  const text = obj.get('text');
  return text instanceof Y.Text ? text : undefined;
}

/**
 * Immutable snapshot of all sticky notes, sorted by (z, id) so concurrent
 * equal-z values (possible once story 3 syncs) still order identically on
 * every client. Unknown object types are skipped (forward compatibility).
 */
export function snapshot(doc: Y.Doc): readonly StickySnapshot[] {
  const out: StickySnapshot[] = [];
  objectsOf(doc).forEach((obj, key) => {
    if (!(obj instanceof Y.Map)) return;
    if (obj.get('type') !== 'sticky') return;
    const text = obj.get('text');
    out.push({
      id: key as string,
      type: 'sticky',
      x: obj.get('x') as number,
      y: obj.get('y') as number,
      color: obj.get('color') as StickyColor,
      text: text instanceof Y.Text ? text.toString() : '',
      z: (obj.get('z') as number) ?? 0,
      createdAt: (obj.get('createdAt') as number) ?? 0,
    });
  });
  out.sort((a, b) => {
    if (a.z !== b.z) return a.z - b.z;
    if (a.id < b.id) return -1;
    if (a.id > b.id) return 1;
    return 0;
  });
  return out;
}
