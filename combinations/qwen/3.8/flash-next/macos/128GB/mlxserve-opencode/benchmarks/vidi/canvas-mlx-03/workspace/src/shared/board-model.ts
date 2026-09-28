// Board document model: the Yjs schema and every mutation. Framework-free so the
// client uses it now and the Durable Object (story 4) can import it unchanged.
// See design "Board document model" contract.
//
// Schema:
//   meta: Y.Map { schemaVersion: 1 }
//   objects: Y.Map<id, Y.Map{ type, x, y, color, text: Y.Text, z, createdAt }>

import * as Y from 'yjs';
import {
  STICKY_SIZE_WORLD,
  STICKY_COLORS,
  DEFAULT_STICKY_COLOR,
  type StickyColor,
} from './config.ts';

/** Transaction origin for local mutations (story 8 undo / story 3 echo-avoidance). */
export const LOCAL_ORIGIN: unique symbol = Symbol('vidi6-local');

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

function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>('objects');
}
function metaMap(doc: Y.Doc): Y.Map<unknown> {
  return doc.getMap<unknown>('meta');
}

function isStickyColor(value: unknown): value is StickyColor {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(STICKY_COLORS, value);
}

function finite(n: number): boolean {
  return Number.isFinite(n);
}

function asNumber(v: unknown): number {
  return typeof v === 'number' ? v : 0;
}

/** The highest z across all objects (sticky or not), or 0 when none. */
function maxZ(objects: Y.Map<Y.Map<unknown>>): number {
  let m = 0;
  for (const o of objects.values()) {
    const z = o.get('z');
    if (typeof z === 'number' && z > m) m = z;
  }
  return m;
}

/** Sets meta.schemaVersion if absent. Idempotent; opens no transaction if present. */
export function initDoc(doc: Y.Doc): void {
  const meta = metaMap(doc);
  if (meta.get('schemaVersion') === undefined) {
    doc.transact(() => {
      meta.set('schemaVersion', SCHEMA_VERSION);
    }, LOCAL_ORIGIN);
  }
}

/**
 * Create a yellow sticky note centred on `at` (top-left = at - size/2), on top of
 * all other notes. Returns the new id.
 */
export function createSticky(
  doc: Y.Doc,
  at: { x: number; y: number },
  color: StickyColor = DEFAULT_STICKY_COLOR,
): string {
  const id = crypto.randomUUID();
  const objects = objectsMap(doc);
  const z = maxZ(objects) + 1;
  const text = new Y.Text('');
  const o = new Y.Map<unknown>();
  doc.transact(() => {
    o.set('type', 'sticky');
    o.set('x', at.x - STICKY_SIZE_WORLD / 2);
    o.set('y', at.y - STICKY_SIZE_WORLD / 2);
    o.set('color', isStickyColor(color) ? color : DEFAULT_STICKY_COLOR);
    o.set('text', text);
    o.set('z', z);
    o.set('createdAt', Date.now());
    objects.set(id, o);
  }, LOCAL_ORIGIN);
  return id;
}

function getSticky(objects: Y.Map<Y.Map<unknown>>, id: string): Y.Map<unknown> | undefined {
  const o = objects.get(id);
  if (o && o.get('type') === 'sticky') return o;
  return undefined;
}

/** Move a note to world (x, y). Returns false for stale id or non-finite coords. */
export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  if (!finite(x) || !finite(y)) return false;
  const objects = objectsMap(doc);
  const o = getSticky(objects, id);
  if (!o) return false;
  doc.transact(() => {
    o.set('x', x);
    o.set('y', y);
  }, LOCAL_ORIGIN);
  return true;
}

/** Raise a note to the top (z = maxZ + 1). No-op/false when already topmost. */
export function bringToFront(doc: Y.Doc, id: string): boolean {
  const objects = objectsMap(doc);
  const o = getSticky(objects, id);
  if (!o) return false;
  const top = maxZ(objects);
  if (o.get('z') === top) return false; // already topmost (max z)
  doc.transact(() => {
    o.set('z', top + 1);
  }, LOCAL_ORIGIN);
  return true;
}

/** Change a note's colour. Rejects unknown colour names and stale ids. */
export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  if (!isStickyColor(color)) return false;
  const objects = objectsMap(doc);
  const o = getSticky(objects, id);
  if (!o) return false;
  doc.transact(() => {
    o.set('color', color);
  }, LOCAL_ORIGIN);
  return true;
}

/** Remove an object by id. Returns false for a stale id. */
export function deleteObject(doc: Y.Doc, id: string): boolean {
  const objects = objectsMap(doc);
  const o = objects.get(id);
  if (!o) return false;
  doc.transact(() => {
    objects.delete(id);
  }, LOCAL_ORIGIN);
  return true;
}

/** The note's Y.Text, or undefined when the id is stale / not a sticky. */
export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const o = getSticky(objectsMap(doc), id);
  const t = o?.get('text');
  return t instanceof Y.Text ? t : undefined;
}

/**
 * Immutable snapshot of all sticky notes, sorted by (z, id) so every client
 * renders a stable stacking order even with concurrent equal z values. Objects
 * with an unknown `type` are skipped (forward compatibility for later stories).
 */
export function snapshot(doc: Y.Doc): readonly StickySnapshot[] {
  const objects = objectsMap(doc);
  const out: StickySnapshot[] = [];
  for (const [id, o] of objects.entries()) {
    if (o.get('type') !== 'sticky') continue;
    const colorVal = o.get('color');
    const textVal = o.get('text');
    out.push({
      id,
      type: 'sticky',
      x: asNumber(o.get('x')),
      y: asNumber(o.get('y')),
      color: isStickyColor(colorVal) ? colorVal : DEFAULT_STICKY_COLOR,
      text: textVal instanceof Y.Text ? textVal.toString() : '',
      z: asNumber(o.get('z')),
      createdAt: asNumber(o.get('createdAt')),
    });
  }
  out.sort((a, b) => (a.z - b.z) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return out;
}
