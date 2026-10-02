import * as Y from 'yjs';
import {
  STICKY_COLORS,
  STICKY_SIZE_WORLD,
  DEFAULT_STICKY_COLOR,
  type StickyColor,
} from './config';

/**
 * Transaction origin for local, user-driven mutations. Story 8 uses it for undo
 * scoping and story 3 uses it to avoid echoing local changes back over the wire.
 */
export const LOCAL_ORIGIN: unique symbol = Symbol('vidi6.local');

const SCHEMA_VERSION = 1;

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

function isStickyColor(value: unknown): value is StickyColor {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(STICKY_COLORS, value);
}

function isFinitePoint(at: { x: number; y: number }): boolean {
  return Number.isFinite(at.x) && Number.isFinite(at.y);
}

function objects(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects');
}

function maxZ(map: Y.Map<Y.Map<unknown>>): number {
  let max = 0;
  for (const obj of map.values()) {
    const z = obj.get('z');
    if (typeof z === 'number' && z > max) max = z;
  }
  return max;
}

/** Set meta.schemaVersion if absent. Idempotent (no transaction when already set). */
export function initDoc(doc: Y.Doc): void {
  const meta = doc.getMap('meta');
  if (meta.get('schemaVersion') === undefined) {
    doc.transact(() => {
      meta.set('schemaVersion', SCHEMA_VERSION);
    }, LOCAL_ORIGIN);
  }
}

/**
 * Create a sticky note centred on `at` (top-left = at - STICKY_SIZE_WORLD/2),
 * on top of all other notes (z = maxZ + 1). Returns the new id, or '' when the
 * coordinates are non-finite (a rejection: no transaction is opened).
 */
export function createSticky(
  doc: Y.Doc,
  at: { x: number; y: number },
  color: StickyColor = DEFAULT_STICKY_COLOR,
): string {
  if (!isFinitePoint(at) || !isStickyColor(color)) return '';

  const id = crypto.randomUUID();
  doc.transact(() => {
    const map = objects(doc);
    const note = new Y.Map<unknown>();
    note.set('type', 'sticky');
    note.set('x', at.x - STICKY_SIZE_WORLD / 2);
    note.set('y', at.y - STICKY_SIZE_WORLD / 2);
    note.set('color', color);
    note.set('text', new Y.Text());
    note.set('z', maxZ(map) + 1);
    note.set('createdAt', Date.now());
    map.set(id, note);
  }, LOCAL_ORIGIN);
  return id;
}

/** Update a note's top-left. Rejects stale ids and non-finite coordinates. */
export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  const note = objects(doc).get(id);
  if (!note || note.get('type') !== 'sticky') return false;

  doc.transact(() => {
    note.set('x', x);
    note.set('y', y);
  }, LOCAL_ORIGIN);
  return true;
}

/** Raise a note above every other note. No-op (false) when already topmost. */
export function bringToFront(doc: Y.Doc, id: string): boolean {
  const map = objects(doc);
  const note = map.get(id);
  if (!note || note.get('type') !== 'sticky') return false;

  // Topmost is the last in render order (max z, then max id). Only that one is a no-op.
  let topId: string | null = null;
  let topZ = -Infinity;
  for (const [oid, obj] of map) {
    if (obj.get('type') !== 'sticky') continue;
    const z = obj.get('z') as number;
    if (z > topZ || (z === topZ && topId !== null && oid > topId)) {
      topZ = z;
      topId = oid;
    }
  }
  if (topId === id) return false;

  doc.transact(() => {
    note.set('z', maxZ(map) + 1);
  }, LOCAL_ORIGIN);
  return true;
}

/** Change a note's colour. Rejects stale ids and unknown colour names. */
export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  if (!isStickyColor(color)) return false;
  const note = objects(doc).get(id);
  if (!note || note.get('type') !== 'sticky') return false;
  if (note.get('color') === color) return false;

  doc.transact(() => {
    note.set('color', color);
  }, LOCAL_ORIGIN);
  return true;
}

/** Remove a note. Rejects stale ids. */
export function deleteObject(doc: Y.Doc, id: string): boolean {
  const map = objects(doc);
  const note = map.get(id);
  if (!note || note.get('type') !== 'sticky') return false;

  doc.transact(() => {
    map.delete(id);
  }, LOCAL_ORIGIN);
  return true;
}

/** The Y.Text backing a note's text, or undefined for a stale/non-sticky id. */
export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const note = objects(doc).get(id);
  if (!note || note.get('type') !== 'sticky') return undefined;
  return note.get('text') as Y.Text;
}

/**
 * Immutable view of all sticky notes, sorted by (z, id) so equal z values
 * (possible once story 3 syncs) render in the same order on every client.
 * Objects with an unknown `type` are skipped for forward compatibility.
 */
export function snapshot(doc: Y.Doc): readonly StickySnapshot[] {
  const result: StickySnapshot[] = [];
  for (const [id, note] of objects(doc)) {
    if (note.get('type') !== 'sticky') continue;
    const text = note.get('text');
    result.push({
      id,
      type: 'sticky',
      x: note.get('x') as number,
      y: note.get('y') as number,
      color: note.get('color') as StickyColor,
      text: text instanceof Y.Text ? text.toString() : String(text ?? ''),
      z: note.get('z') as number,
      createdAt: note.get('createdAt') as number,
    });
  }
  result.sort((a, b) => (a.z !== b.z ? a.z - b.z : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return result;
}
