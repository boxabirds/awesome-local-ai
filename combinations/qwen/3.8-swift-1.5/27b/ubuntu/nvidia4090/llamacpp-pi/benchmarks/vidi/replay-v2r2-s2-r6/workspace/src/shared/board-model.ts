import * as Y from 'yjs';
import {
  STICKY_SIZE_WORLD,
  STICKY_COLORS,
  DEFAULT_STICKY_COLOR,
  type StickyColor,
} from './config';

/**
 * Origin marker for local (user-driven) transactions.
 * Story 8 (undo) filters on this; story 3 uses it to avoid echoing
 * local changes back over the network.
 */
export const LOCAL_ORIGIN: unique symbol = Symbol('vidi6.local-origin');

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

function isStickyColor(value: unknown): value is StickyColor {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(STICKY_COLORS, value);
}

function isFinitePoint(x: number, y: number): boolean {
  return Number.isFinite(x) && Number.isFinite(y);
}

function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects') as Y.Map<Y.Map<unknown>>;
}

function maxZ(doc: Y.Doc): number {
  let max = 0;
  objectsMap(doc).forEach((obj) => {
    const z = obj.get('z');
    if (typeof z === 'number' && Number.isFinite(z) && z > max) max = z;
  });
  return max;
}

/**
 * Ensures `meta.schemaVersion` exists. Sets it once; never overwrites an
 * existing value (future migrations own that).
 */
export function initDoc(doc: Y.Doc): void {
  const meta = doc.getMap('meta');
  if (!meta.has('schemaVersion')) {
    doc.transact(
      () => {
        meta.set('schemaVersion', SCHEMA_VERSION);
      },
      LOCAL_ORIGIN,
    );
  }
}

/**
 * Creates a sticky note centred on `at` (top-left = point - STICKY_SIZE_WORLD/2),
 * on top of all other notes (z = maxZ + 1).
 * Returns the new id, or `false` for non-finite coordinates / unknown colour.
 */
export function createSticky(
  doc: Y.Doc,
  at: { x: number; y: number },
  color: StickyColor = DEFAULT_STICKY_COLOR,
): string | false {
  if (!isFinitePoint(at.x, at.y)) return false;
  if (!isStickyColor(color)) return false;

  const id = crypto.randomUUID();
  const x = at.x - STICKY_SIZE_WORLD / 2;
  const y = at.y - STICKY_SIZE_WORLD / 2;

  doc.transact(
    () => {
      const obj = new Y.Map<unknown>();
      obj.set('type', 'sticky');
      obj.set('x', x);
      obj.set('y', y);
      obj.set('color', color);
      obj.set('text', new Y.Text());
      obj.set('z', maxZ(doc) + 1);
      obj.set('createdAt', Date.now());
      objectsMap(doc).set(id, obj);
    },
    LOCAL_ORIGIN,
  );
  return id;
}

/** Moves a note's top-left to world (x, y). */
export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  if (!isFinitePoint(x, y)) return false;
  const obj = objectsMap(doc).get(id);
  if (!obj) return false;
  doc.transact(
    () => {
      obj.set('x', x);
      obj.set('y', y);
    },
    LOCAL_ORIGIN,
  );
  return true;
}

/** Puts a note above all others (z = maxZ + 1). No-op if already topmost. */
export function bringToFront(doc: Y.Doc, id: string): boolean {
  const obj = objectsMap(doc).get(id);
  if (!obj) return false;
  const z = obj.get('z');
  if (typeof z !== 'number' || z >= maxZ(doc)) return false;
  doc.transact(
    () => {
      obj.set('z', maxZ(doc) + 1);
    },
    LOCAL_ORIGIN,
  );
  return true;
}

/** Sets the note colour. Unknown colour names or stale ids are rejected. */
export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  if (!isStickyColor(color)) return false;
  const obj = objectsMap(doc).get(id);
  if (!obj) return false;
  doc.transact(
    () => {
      obj.set('color', color);
    },
    LOCAL_ORIGIN,
  );
  return true;
}

/** Removes a note from the board. */
export function deleteObject(doc: Y.Doc, id: string): boolean {
  const objects = objectsMap(doc);
  if (!objects.has(id)) return false;
  doc.transact(
    () => {
      objects.delete(id);
    },
    LOCAL_ORIGIN,
  );
  return true;
}

/** The note's Y.Text, or undefined for stale/unknown ids. */
export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const obj = objectsMap(doc).get(id);
  if (!obj) return undefined;
  const text = obj.get('text');
  return text instanceof Y.Text ? text : undefined;
}

/**
 * Immutable render snapshot of all sticky notes, sorted by (z, id) so that
 * concurrent equal-z values (possible once story 3 syncs) give every client
 * the same order. Unknown object types are skipped (forward compatibility).
 */
export function snapshot(doc: Y.Doc): readonly StickySnapshot[] {
  const result: StickySnapshot[] = [];
  objectsMap(doc).forEach((obj, id) => {
    if (obj.get('type') !== 'sticky') return;
    const x = obj.get('x');
    const y = obj.get('y');
    const z = obj.get('z');
    const color = obj.get('color');
    if (typeof x !== 'number' || typeof y !== 'number' || typeof z !== 'number') return;
    if (!isStickyColor(color)) return;
    const text = obj.get('text');
    const createdAt = obj.get('createdAt');
    result.push({
      id,
      type: 'sticky',
      x,
      y,
      color,
      text: text instanceof Y.Text ? text.toString() : '',
      z,
      createdAt: typeof createdAt === 'number' ? createdAt : 0,
    });
  });
  result.sort((a, b) => a.z - b.z || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return result;
}
