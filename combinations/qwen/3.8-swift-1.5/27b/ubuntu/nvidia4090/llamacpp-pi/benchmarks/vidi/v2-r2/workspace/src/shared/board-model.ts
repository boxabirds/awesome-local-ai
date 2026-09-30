import * as Y from 'yjs';
import { STICKY_SIZE_WORLD, DEFAULT_STICKY_COLOR, STICKY_COLORS, type StickyColor } from './config';

// Origin used for all local transactions (story 8 undo and story 3 echo suppression).
export const LOCAL_ORIGIN: unique symbol = Symbol('vidi6.local');

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

function objects(doc: Y.Doc): Y.Map<ObjectMap> {
  return doc.getMap('objects') as Y.Map<ObjectMap>;
}

function isSticky(obj: ObjectMap): boolean {
  return obj.get('type') === 'sticky';
}

function maxZ(doc: Y.Doc): number {
  let max = 0;
  objects(doc).forEach((obj) => {
    const z = obj.get('z');
    if (typeof z === 'number' && z > max) max = z;
  });
  return max;
}

/**
 * Sets meta.schemaVersion (if absent) and ensures the objects map exists.
 * Idempotent.
 */
export function initDoc(doc: Y.Doc): void {
  const meta = doc.getMap('meta');
  if (!meta.has('schemaVersion')) {
    meta.set('schemaVersion', SCHEMA_VERSION);
  }
  objects(doc);
}

/**
 * Creates a yellow (or given colour) sticky note centred on `at` (world units),
 * on top of all other notes (z = maxZ + 1). Returns the new id, or false for
 * non-finite coordinates.
 */
export function createSticky(
  doc: Y.Doc,
  at: { x: number; y: number },
  color: StickyColor = DEFAULT_STICKY_COLOR
): string | false {
  if (!Number.isFinite(at.x) || !Number.isFinite(at.y)) return false;
  if (!(color in STICKY_COLORS)) return false;
  const id = crypto.randomUUID();
  const text = new Y.Text();
  doc.transact(() => {
    const obj = new Y.Map();
    obj.set('type', 'sticky');
    obj.set('x', at.x - STICKY_SIZE_WORLD / 2);
    obj.set('y', at.y - STICKY_SIZE_WORLD / 2);
    obj.set('color', color);
    obj.set('text', text);
    obj.set('z', maxZ(doc) + 1);
    obj.set('createdAt', Date.now());
    objects(doc).set(id, obj);
  }, LOCAL_ORIGIN);
  return id;
}

/** Moves a note's top-left to (x, y) world units. False for stale ids / non-finite coords. */
export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  const obj = objects(doc).get(id);
  if (!obj || !isSticky(obj)) return false;
  doc.transact(() => {
    obj.set('x', x);
    obj.set('y', y);
  }, LOCAL_ORIGIN);
  return true;
}

/** Raises a note to the top of the stack. False if already topmost or stale. */
export function bringToFront(doc: Y.Doc, id: string): boolean {
  const obj = objects(doc).get(id);
  if (!obj || !isSticky(obj)) return false;
  const z = obj.get('z');
  if (typeof z !== 'number' || z >= maxZ(doc)) return false;
  doc.transact(() => {
    obj.set('z', maxZ(doc) + 1);
  }, LOCAL_ORIGIN);
  return true;
}

/** Sets a note's colour to one of the six presets. False for unknown colours / stale ids. */
export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  if (!(color in STICKY_COLORS)) return false;
  const obj = objects(doc).get(id);
  if (!obj || !isSticky(obj)) return false;
  doc.transact(() => {
    obj.set('color', color);
  }, LOCAL_ORIGIN);
  return true;
}

/** Removes a note. False for stale ids. */
export function deleteObject(doc: Y.Doc, id: string): boolean {
  const obj = objects(doc).get(id);
  if (!obj || !isSticky(obj)) return false;
  doc.transact(() => {
    objects(doc).delete(id);
  }, LOCAL_ORIGIN);
  return true;
}

/** Returns the Y.Text of a note, or undefined for stale / non-sticky ids. */
export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const obj = objects(doc).get(id);
  if (!obj || !isSticky(obj)) return undefined;
  const text = obj.get('text');
  return text instanceof Y.Text ? text : undefined;
}

/**
 * Immutable snapshot of all sticky notes, sorted by (z, id) so concurrent equal
 * z values (story 3) still give every client the same order. Unknown types are
 * skipped (forward compatibility for stories 9–12).
 */
export function snapshot(doc: Y.Doc): readonly StickySnapshot[] {
  const result: StickySnapshot[] = [];
  objects(doc).forEach((obj, id) => {
    if (!isSticky(obj)) return;
    const x = obj.get('x');
    const y = obj.get('y');
    const z = obj.get('z');
    const color = obj.get('color');
    if (typeof x !== 'number' || typeof y !== 'number' || typeof z !== 'number') return;
    if (typeof color !== 'string' || !(color in STICKY_COLORS)) return;
    const text = obj.get('text');
    const createdAt = obj.get('createdAt');
    result.push({
      id,
      type: 'sticky',
      x,
      y,
      color: color as StickyColor,
      text: text instanceof Y.Text ? text.toString() : '',
      z,
      createdAt: typeof createdAt === 'number' ? createdAt : 0,
    });
  });
  result.sort((a, b) => (a.z === b.z ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : a.z - b.z));
  return result;
}
